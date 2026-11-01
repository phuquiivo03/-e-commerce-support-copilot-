# Architecture

## System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser                                                                  │
│   Next.js App Router pages (login, inbox, ticket detail, KB, eval)       │
│   TanStack Query for client state, Zod for form validation               │
└──────────────┬───────────────────────────────────────────────┬───────────┘
               │ session cookies (@supabase/ssr)               │
┌──────────────▼───────────────────────────────────────────────▼───────────┐
│ Next.js server (apps/web)                                                │
│                                                                          │
│  proxy.ts  ── session refresh + page guards                              │
│  /api/**   ── REST route handlers                                        │
│      │      requireUser() → session JWT → profiles.role                  │
│      │      Zod DTO validation, { data } / { error } envelope             │
│      │                                                                   │
│      ├── user-scoped Supabase client (RLS enforced per query)            │
│      ├── service-role client (copilot, audit, ingestion enqueue)         │
│      │                                                                   │
│      ├── lib/copilot  ── orchestration pipeline (see docs/rag-pipeline)  │
│      ├── lib/rag      ── chunking, embeddings, retrieval, reranker       │
│      └── lib/llm      ── provider adapter + deterministic fallback       │
└──────────────┬───────────────────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────────────────┐
│ Supabase (local docker stack / hosted project)                           │
│                                                                          │
│  GoTrue (Auth, JWT, app_metadata roles)                                  │
│  Kong ──► PostgREST Data API (public + rag + app schemas)                │
│  PostgreSQL 17                                                           │
│    ├── public.* tables, ALL with RLS (see below)                         │
│    ├── extensions.vector (pgvector, HNSW index on kb_chunks.embedding)   │
│    ├── rag.hybrid_search()      private schema, service_role only         │
│    └── app.create_return_request() user JWT, transactional + idempotent  │
└──────────────────────────────────────────────────────────────────────────┘
               ▲
               │ claims jobs (FOR UPDATE SKIP LOCKED)
┌──────────────┴───────────────────────────────────────────────────────────┐
│ Ingestion worker (npm run worker)                                        │
│   claim job → chunk (heading-aware) → embed (adapter) →                  │
│   transactional chunk replacement → SUCCEEDED / retry / FAILED           │
└──────────────────────────────────────────────────────────────────────────┘
```

## Identity, roles, and authorization

- Roles are `ADMIN`, `SUPPORT_AGENT`, `CUSTOMER` (Postgres enum `user_role`).
- The role is stored in **`auth.users.raw_app_meta_data`** — `user_metadata` is
  user-editable and is never used for authorization (per the Supabase security
  checklist).
- A trigger (`handle_new_user`) mirrors each auth user into `public.profiles`
  with their role. Policies and route handlers read the **live profile row**,
  not JWT claims, so role changes take effect immediately.
- Helper functions `public.has_role(role)` / `public.is_staff()` are
  `SECURITY DEFINER` read-only lookups locked to `authenticated` + `service_role`
  (revoked from `public`/`anon`), avoiding recursive RLS on `profiles`.
- **Every table in the exposed `public` schema has RLS enabled.** Policies
  always combine `TO authenticated` with an ownership predicate or role check.
  Tables that must not be user-writable (orders, payments, audit logs,
  ingestion jobs, eval runs) have **no** INSERT/UPDATE policies at all — only
  the service role can write them.

## Trust boundaries

1. **Frontend is untrusted.** The UI never sends a customer/role identity that
   the backend trusts; every request is re-authenticated via the session cookie
   and scoped by RLS.
2. **Customer messages and retrieved documents are untrusted data.** They are
   delimited as `<untrusted_*>` blocks in the LLM prompt; a deterministic
   guardrail module flags injection attempts; instructions inside untrusted
   content can never change outcomes, permissions, or tool behavior.
3. **LLM output is untrusted.** Structured outputs are validated with Zod
   (`CopilotResponseSchema`), citations are re-validated against actually
   retrieved chunks (quote must appear verbatim) and actually loaded order
   fields, and outcome guardrails can downgrade (e.g. `ANSWER` with zero valid
   citations → `PARTIAL_ANSWER`). The persisted draft is what remains after
   these gates.
4. **The LLM never touches the database.** All structured data is fetched by
   backend services; the model only receives a JSON context snapshot.

## Copilot outcomes

`ANSWER` / `PARTIAL_ANSWER` / `CLARIFY` / `ABSTAIN` / `ESCALATE` — the outcome
is chosen by deterministic rules (evidence sufficiency, missing essential
info, guardrail hits), not by the model's own confidence. The LLM (when
enabled) drafts wording and citation selection; the deterministic layer owns
the decision envelope. See docs/rag-pipeline.md for the decision table.

## Returns workflow

- Eligibility is computed by a **pure function** (`lib/copilot/rules/returns.ts`)
  from database facts: ownership, order status, delivery date, product
  category windows (Electronics 14d, default 30d — mirroring the published
  policy), product returnability, and existing requests. Missing inputs yield
  `INDETERMINATE`, never a guess.
- Creation goes through **`app.create_return_request`** (private `app` schema),
  called with the user's JWT so `auth.uid()` identifies the real caller. It
  enforces ownership, cancelled-order and active-return checks, and
  idempotency via `unique(order_id, idempotency_key)` + `ON CONFLICT`, writes
  the audit row, all in one transaction. There is deliberately **no direct
  INSERT policy** on `return_requests`.
- Refund execution is out of scope by design; `refund execution` never appears
  as an action the copilot or agents can trigger.

## Observability

- `audit_logs` records security-relevant state changes (return creation,
  escalation, KB publish/supersede, draft generation) with actor, role,
  correlation id, and metadata.
- `copilot_runs` persists the full execution trace per draft: classification,
  guardrail results, retrieval ids and scores, rule outcomes, provider, latency,
  and dropped-citation counts.
- API errors return stable codes (`VALIDATION_ERROR`, `FORBIDDEN`, …) without
  stack traces; unexpected errors are logged server-side with a generic 500.
- No passwords, tokens, or payment secrets are logged; payment records expose
  only status and last4 in demo data.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and unit tests on every push,
then a second job boots the Supabase CLI stack, applies migrations + seed,
indexes documents with the worker, runs the integration suite, and builds the
app. The evaluation suite is intended to run manually (`npm run eval`) since it
exercises live workflows.
