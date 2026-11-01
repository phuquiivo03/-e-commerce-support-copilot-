-- Core domain schema for the E-commerce Support Copilot.
-- All application tables live in `public` (exposed via the Data API) and are
-- protected by RLS (see 20261030000003_rls.sql). Private helper schemas
-- `app` and `rag` are created in 20261030000004_functions.sql.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('ADMIN', 'SUPPORT_AGENT', 'CUSTOMER');
create type public.order_status as enum ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED');
create type public.payment_status as enum ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
create type public.shipment_status as enum ('PENDING', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION', 'RETURNED');
create type public.ticket_status as enum ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED');
create type public.ticket_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
create type public.ticket_category as enum ('ORDER_STATUS', 'RETURNS', 'REFUNDS', 'SHIPPING', 'WARRANTY', 'OTHER');
create type public.message_author as enum ('CUSTOMER', 'AGENT', 'AI_DRAFT', 'SYSTEM');
create type public.kb_document_status as enum ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');
create type public.kb_document_category as enum ('SHIPPING', 'CANCELLATION', 'RETURNS', 'REFUNDS', 'WARRANTY');
create type public.return_request_status as enum ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');
create type public.ingestion_job_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
create type public.copilot_outcome as enum ('ANSWER', 'CLARIFY', 'PARTIAL_ANSWER', 'ABSTAIN', 'ESCALATE');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity: profiles mirror auth.users, role comes from app_metadata
-- (raw_user_meta_data is user-editable and must never drive authorization).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role public.user_role not null default 'CUSTOMER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'CUSTOMER')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Customer-specific profile data (one-to-one with CUSTOMER profiles).
create table public.customers (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  phone text,
  shipping_address text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog / orders / payments / shipments
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  returnable boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers (profile_id) on delete cascade,
  status public.order_status not null default 'PENDING',
  placed_at timestamptz not null default now(),
  currency text not null default 'USD',
  total_cents integer not null default 0 check (total_cents >= 0),
  -- Authoritative delivery timestamp; null until the order is actually delivered.
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  created_at timestamptz not null default now()
);
create index order_items_order_id_idx on public.order_items (order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  status public.payment_status not null,
  amount_cents integer not null check (amount_cents >= 0),
  method text not null default 'card',
  last4 text,
  transaction_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  carrier text not null default 'DemoParcel',
  tracking_number text not null unique,
  status public.shipment_status not null default 'PENDING',
  shipped_at timestamptz,
  estimated_delivery timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger shipments_set_updated_at before update on public.shipments
  for each row execute function public.set_updated_at();
create index shipments_order_id_idx on public.shipments (order_id);

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  status public.shipment_status not null,
  description text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index shipment_events_shipment_id_idx on public.shipment_events (shipment_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Support tickets and conversations
-- ---------------------------------------------------------------------------
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  customer_id uuid not null references public.customers (profile_id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  subject text not null,
  category public.ticket_category not null default 'OTHER',
  priority public.ticket_priority not null default 'MEDIUM',
  status public.ticket_status not null default 'OPEN',
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tickets_set_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();
create index tickets_customer_idx on public.tickets (customer_id);
create index tickets_status_idx on public.tickets (status);

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_type public.message_author not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

-- One row per copilot draft generation, including evidence and execution trace.
create table public.copilot_runs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  triggered_by uuid references public.profiles (id) on delete set null,
  question text not null,
  outcome public.copilot_outcome not null,
  message text not null,
  citations jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  suggested_next_actions jsonb not null default '[]'::jsonb,
  requires_human_review boolean not null default false,
  provider text not null,
  latency_ms integer,
  trace jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index copilot_runs_ticket_idx on public.copilot_runs (ticket_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Knowledge base: versioned documents + embedded chunks
-- ---------------------------------------------------------------------------
create table public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category public.kb_document_category not null,
  version integer not null default 1 check (version >= 1),
  status public.kb_document_status not null default 'DRAFT',
  effective_from date not null default current_date,
  effective_to date,
  region text not null default 'US',
  product_category text,
  content text not null default '',
  superseded_by uuid references public.kb_documents (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One version per (title, region) pair; publishing a new version supersedes the old one.
  unique (title, version, region)
);
create trigger kb_documents_set_updated_at before update on public.kb_documents
  for each row execute function public.set_updated_at();

create table public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  document_version integer not null,
  chunk_index integer not null,
  heading text,
  content text not null,
  embedding extensions.vector(1536),
  embedding_model text,
  content_hash text not null,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index kb_chunks_embedding_idx on public.kb_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index kb_chunks_fts_idx on public.kb_chunks using gin (fts);
create index kb_chunks_document_idx on public.kb_chunks (document_id);

-- ---------------------------------------------------------------------------
-- Background ingestion jobs (Postgres-backed queue, see docs/rag-pipeline.md)
-- ---------------------------------------------------------------------------
create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  status public.ingestion_job_status not null default 'QUEUED',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ingestion_jobs_status_idx on public.ingestion_jobs (status, created_at);
create trigger ingestion_jobs_set_updated_at before update on public.ingestion_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Return requests (creation goes through app.create_return_request RPC only)
-- ---------------------------------------------------------------------------
create table public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  customer_id uuid not null references public.customers (profile_id) on delete cascade,
  item_ids jsonb not null default '[]'::jsonb,
  reason text not null,
  status public.return_request_status not null default 'PENDING_REVIEW',
  idempotency_key text not null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, idempotency_key)
);
create index return_requests_customer_idx on public.return_requests (customer_id);
create trigger return_requests_set_updated_at before update on public.return_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log and evaluation runs
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role public.user_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_size integer not null,
  results jsonb not null,
  report_markdown text,
  created_at timestamptz not null default now()
);
