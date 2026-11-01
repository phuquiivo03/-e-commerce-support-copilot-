-- Row Level Security for every table in the exposed `public` schema.
--
-- Rules followed (Supabase security checklist):
--   * RLS is enabled on every public table; no policy means deny.
--   * `TO authenticated` is always combined with an ownership/role predicate
--     (plain `TO authenticated` would be authentication without authorization).
--   * UPDATE policies always have both USING and WITH CHECK.
--   * Authorization never reads user_metadata; roles live in public.profiles,
--     which is kept in sync from auth.users.raw_app_meta_data by trigger.
--   * Helper functions live in private schemas or are locked down with
--     explicit REVOKE/GRANT (see 20261030000004_functions.sql).

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.copilot_runs enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.return_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.eval_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER but read-only and self-scoped; callable only
-- by authenticated and service_role).
-- ---------------------------------------------------------------------------
create or replace function public.has_role(target public.user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = target
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('ADMIN', 'SUPPORT_AGENT')
  );
$$;

revoke all on function public.has_role(public.user_role) from public, anon;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.has_role(public.user_role) to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles / customers
-- ---------------------------------------------------------------------------
create policy "profiles: read own or staff reads all"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_staff());

create policy "customers: read own or staff reads all"
  on public.customers for select
  to authenticated
  using (profile_id = auth.uid() or public.is_staff());

create policy "customers: update own contact info"
  on public.customers for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Catalog (read-only for authenticated users)
-- ---------------------------------------------------------------------------
create policy "products: authenticated can read"
  on public.products for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Orders: customers see only their own; staff see all
-- ---------------------------------------------------------------------------
create policy "orders: own or staff"
  on public.orders for select
  to authenticated
  using (
    exists (
      select 1 from public.customers c
      where c.profile_id = auth.uid() and c.profile_id = orders.customer_id
    )
    or public.is_staff()
  );

create policy "order_items: own or staff"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      join public.customers c on c.profile_id = o.customer_id
      where o.id = order_items.order_id and c.profile_id = auth.uid()
    )
    or public.is_staff()
  );

create policy "payments: own or staff"
  on public.payments for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      join public.customers c on c.profile_id = o.customer_id
      where o.id = payments.order_id and c.profile_id = auth.uid()
    )
    or public.is_staff()
  );

create policy "shipments: own or staff"
  on public.shipments for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      join public.customers c on c.profile_id = o.customer_id
      where o.id = shipments.order_id and c.profile_id = auth.uid()
    )
    or public.is_staff()
  );

create policy "shipment_events: own or staff"
  on public.shipment_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.shipments s
      join public.orders o on o.id = s.order_id
      join public.customers c on c.profile_id = o.customer_id
      where s.id = shipment_events.shipment_id and c.profile_id = auth.uid()
    )
    or public.is_staff()
  );

-- ---------------------------------------------------------------------------
-- Tickets and messages
-- ---------------------------------------------------------------------------
create policy "tickets: own or staff"
  on public.tickets for select
  to authenticated
  using (customer_id = auth.uid() or public.is_staff());

create policy "tickets: customers create own"
  on public.tickets for insert
  to authenticated
  with check (
    exists (
      select 1 from public.customers c
      where c.profile_id = auth.uid() and c.profile_id = tickets.customer_id
    )
  );

create policy "tickets: staff update (assignment, status, priority)"
  on public.tickets for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "ticket_messages: visible to ticket owner and staff"
  on public.ticket_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_messages.ticket_id
        and (t.customer_id = auth.uid() or public.is_staff())
    )
  );

create policy "ticket_messages: customers reply on own tickets"
  on public.ticket_messages for insert
  to authenticated
  with check (
    author_type = 'CUSTOMER'
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_messages.ticket_id and t.customer_id = auth.uid()
    )
  );

create policy "ticket_messages: staff reply on any ticket"
  on public.ticket_messages for insert
  to authenticated
  with check (author_type = 'AGENT' and public.is_staff());

-- ---------------------------------------------------------------------------
-- Copilot runs: same visibility as their ticket; written via service role only
-- ---------------------------------------------------------------------------
create policy "copilot_runs: ticket owner or staff"
  on public.copilot_runs for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = copilot_runs.ticket_id
        and (t.customer_id = auth.uid() or public.is_staff())
    )
  );

-- ---------------------------------------------------------------------------
-- Knowledge base
-- ---------------------------------------------------------------------------
create policy "kb_documents: staff read all"
  on public.kb_documents for select
  to authenticated
  using (public.is_staff());

create policy "kb_documents: authenticated read currently published"
  on public.kb_documents for select
  to authenticated
  using (
    status = 'PUBLISHED'
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
  );

create policy "kb_documents: admin insert"
  on public.kb_documents for insert
  to authenticated
  with check (public.has_role('ADMIN'));

create policy "kb_documents: admin update"
  on public.kb_documents for update
  to authenticated
  using (public.has_role('ADMIN'))
  with check (public.has_role('ADMIN'));

create policy "kb_chunks: staff read all"
  on public.kb_chunks for select
  to authenticated
  using (public.is_staff());

create policy "kb_chunks: authenticated read chunks of published docs"
  on public.kb_chunks for select
  to authenticated
  using (
    exists (
      select 1 from public.kb_documents d
      where d.id = kb_chunks.document_id
        and d.status = 'PUBLISHED'
        and d.effective_from <= current_date
        and (d.effective_to is null or d.effective_to >= current_date)
    )
  );

-- ---------------------------------------------------------------------------
-- Ingestion jobs: admin visibility; writes via service role only
-- ---------------------------------------------------------------------------
create policy "ingestion_jobs: admin read"
  on public.ingestion_jobs for select
  to authenticated
  using (public.has_role('ADMIN'));

-- ---------------------------------------------------------------------------
-- Return requests: own or staff; creation/decisions via RPC and service role
-- ---------------------------------------------------------------------------
create policy "return_requests: own or staff"
  on public.return_requests for select
  to authenticated
  using (customer_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- Audit logs: admin read-only; writes via service role only
-- ---------------------------------------------------------------------------
create policy "audit_logs: admin read"
  on public.audit_logs for select
  to authenticated
  using (public.has_role('ADMIN'));

-- ---------------------------------------------------------------------------
-- Evaluation runs: staff read-only; writes via service role only
-- ---------------------------------------------------------------------------
create policy "eval_runs: staff read"
  on public.eval_runs for select
  to authenticated
  using (public.is_staff());
