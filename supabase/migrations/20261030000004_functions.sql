-- Private schemas holding trusted SQL entry points.
--
-- `rag`   : hybrid retrieval (full-text + pgvector, fused with Reciprocal
--           Rank Fusion). Not callable by end-user roles; the Next.js server
--           calls it with the service role key after its own authorization.
-- `app`   : transactional workflows callable with the *user's* JWT so that
--           auth.uid() identifies the real caller (return request creation).

create schema if not exists rag;
create schema if not exists app;

revoke all on schema rag from public, anon, authenticated;
revoke all on schema app from public, anon, authenticated;
grant usage on schema rag to service_role;
grant usage on schema app to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- rag.hybrid_search
-- Retrieves only currently-published, applicable policy chunks and fuses
-- lexical (ts_rank) and semantic (cosine distance) rankings with RRF (k=60).
-- ---------------------------------------------------------------------------
create or replace function rag.hybrid_search(
  p_query text,
  p_query_embedding text,          -- pgvector text literal: '[0.1,0.2,...]'
  p_categories text[] default null,
  p_region text default null,
  p_product_category text default null,
  p_match_count integer default 8,
  p_rrf_k integer default 60
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  document_version integer,
  category text,
  region text,
  product_category text,
  heading text,
  content text,
  score double precision,
  fts_rank integer,
  vector_rank integer
)
language sql
stable
security invoker
set search_path = extensions, public
as $$
  with applicable as (
    select d.id, d.title, d.version, d.category, d.region, d.product_category
    from kb_documents d
    where d.status = 'PUBLISHED'
      and d.effective_from <= current_date
      and (d.effective_to is null or d.effective_to >= current_date)
      and (p_categories is null or d.category::text = any (p_categories))
      and (p_region is null or d.region = p_region)
      and (
        p_product_category is null
        or d.product_category is null
        or d.product_category = p_product_category
      )
  ),
  fts as (
    select c.id as chunk_id,
           row_number() over (
             order by ts_rank(c.fts, websearch_to_tsquery('english', p_query)) desc
           ) as rank
    from kb_chunks c
    join applicable a on a.id = c.document_id
    where c.fts @@ websearch_to_tsquery('english', p_query)
    order by rank
    limit 50
  ),
  vec as (
    select c.id as chunk_id,
           row_number() over (
             order by c.embedding <=> p_query_embedding::extensions.vector
           ) as rank
    from kb_chunks c
    join applicable a on a.id = c.document_id
    where c.embedding is not null
    order by c.embedding <=> p_query_embedding::extensions.vector
    limit 50
  ),
  fused as (
    select coalesce(f.chunk_id, v.chunk_id) as chunk_id,
           coalesce(1.0 / (p_rrf_k + f.rank), 0)
             + coalesce(1.0 / (p_rrf_k + v.rank), 0) as score,
           f.rank as fts_rank,
           v.rank as vector_rank
    from fts f
    full outer join vec v on v.chunk_id = f.chunk_id
  )
  select
    c.id,
    c.document_id,
    a.title,
    c.document_version,
    a.category,
    a.region,
    a.product_category,
    c.heading,
    c.content,
    f.score,
    f.fts_rank,
    f.vector_rank
  from fused f
  join kb_chunks c on c.id = f.chunk_id
  join applicable a on a.id = c.document_id
  order by f.score desc
  limit p_match_count;
$$;

revoke all on function rag.hybrid_search(text, text, text[], text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function rag.hybrid_search(text, text, text[], text, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- app.create_return_request
-- Transactional, idempotent return-request creation. Runs with the caller's
-- JWT (SECURITY DEFINER only so it can write audit rows); ownership and
-- duplicate handling are enforced here, not in the client.
-- ---------------------------------------------------------------------------
create or replace function app.create_return_request(
  p_order_id uuid,
  p_idempotency_key text,
  p_reason text,
  p_item_ids jsonb default '[]'::jsonb,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_profile_id uuid;
  v_role public.user_role;
  v_order public.orders;
  v_existing public.return_requests;
  v_created public.return_requests;
  v_was_created boolean;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select id, role into v_profile_id, v_role from profiles where id = auth.uid();
  if v_profile_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Only the owning customer (or staff, for MVP manual entry) may create.
  if v_role = 'CUSTOMER' and v_order.customer_id <> v_profile_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_role not in ('CUSTOMER', 'ADMIN', 'SUPPORT_AGENT') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Idempotent replay: same order + same key returns the original request.
  select * into v_existing
  from return_requests
  where order_id = p_order_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('created', false, 'return_request', to_jsonb(v_existing));
  end if;

  if v_order.status = 'CANCELLED' then
    raise exception 'ORDER_CANCELLED' using errcode = '23514';
  end if;

  if exists (
    select 1 from return_requests
    where order_id = p_order_id and status in ('PENDING_REVIEW', 'APPROVED')
  ) then
    raise exception 'RETURN_ALREADY_ACTIVE' using errcode = '23514';
  end if;

  insert into return_requests (order_id, customer_id, item_ids, reason, idempotency_key, status)
  values (p_order_id, v_order.customer_id, p_item_ids, p_reason, p_idempotency_key, 'PENDING_REVIEW')
  on conflict (order_id, idempotency_key) do nothing
  returning * into v_created;

  if v_created is null then
    -- Lost a race against a concurrent identical insert: replay idempotently.
    select * into v_created
    from return_requests
    where order_id = p_order_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object('created', false, 'return_request', to_jsonb(v_created));
  end if;

  v_was_created := true;

  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    v_role,
    'return_request.created',
    'return_request',
    v_created.id::text,
    jsonb_build_object(
      'order_id', p_order_id,
      'idempotency_key', p_idempotency_key,
      'evidence', p_evidence
    )
  );

  return jsonb_build_object('created', v_was_created, 'return_request', to_jsonb(v_created));
end;
$$;

revoke all on function app.create_return_request(uuid, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function app.create_return_request(uuid, text, text, jsonb, jsonb)
  to authenticated, service_role;
