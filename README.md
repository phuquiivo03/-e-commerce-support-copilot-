# E-commerce Support Copilot (MVP)

An AI-assisted customer support workspace that helps support agents handle
order-related complaints. It combines:

- **RAG** over versioned shipping / cancellation / return / refund / warranty policies
- **Authoritative structured data** from PostgreSQL for orders, shipments, and payments
- **Deterministic business rules** for return eligibility
- **LLM-generated drafts with validated citations**, with a fully deterministic fallback
- **Controlled return-request workflow** (idempotent, audited, no real refunds)
- **Audit logs and a repeatable evaluation suite**

The AI never invents order status, shipping dates, policy conditions, payment
status, or refund completion — facts come from the database, policy text from
retrieved chunks, and every citation is validated before persistence.

This is a simulated store with seeded demo data. No real payment processing, no
real refunds.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS v4, TanStack Query, Zod |
| Backend | Supabase (PostgreSQL 17 + pgvector, Auth/JWT, RLS) + Next.js Route Handlers (REST) |
| Background jobs | Postgres-backed queue on `ingestion_jobs` (FOR UPDATE SKIP LOCKED, bounded retries) |
| RAG | pgvector HNSW + PostgreSQL full-text search, Reciprocal Rank Fusion, optional reranker |
| Design | Flat design system per `DESIGN.md` (Outfit font, color blocking, no shadows) |

### Architectural decisions & deviations from the original spec

The task specification described a self-hosted NestJS + Prisma + Redis/BullMQ
stack. Per direction to build on **Supabase** (and following the Supabase agent
skill), this MVP maps those responsibilities onto the Supabase platform:

- **NestJS API → Next.js Route Handlers + Supabase.** REST endpoints live in
  `apps/web/src/app/api/**` with a uniform `{ data } / { error }` envelope, Zod
  DTO validation, consistent status codes, pagination, and an OpenAPI 3.1
  description at `/api/openapi` (Swagger UI at `/api-docs`).
- **NestJS JWT auth + RBAC → Supabase Auth + RLS.** Sessions are JWTs issued by
  GoTrue and stored in httpOnly cookies (`@supabase/ssr`). Roles
  (`ADMIN` / `SUPPORT_AGENT` / `CUSTOMER`) live in `auth.users.raw_app_meta_data`
  (never user-editable) and are mirrored into `public.profiles` by trigger.
  Authorization is enforced **in PostgreSQL with RLS policies** (ownership
  predicates + role checks), which is stronger than guard-level checks alone.
- **Prisma → SQL migrations.** Schema changes are hand-authored Supabase
  migrations (`supabase/migrations/`), which is the platform-native workflow and
  keeps pgvector / RLS / function definitions reviewable in SQL.
- **Redis + BullMQ → Postgres-backed queue.** Supabase does not provide Redis.
  Ingestion jobs are claimed with `FOR UPDATE SKIP LOCKED` (the same concurrency
  semantics BullMQ provides), retried with a bounded attempt count, and chunk
  replacement runs in a single transaction so a failed job can never leave a
  document half-indexed.
- **shadcn/ui → flat-design component kit.** The UI uses a shadcn-style
  component structure (`components/ui/*`, CVA variants) restyled to the flat
  design system in `DESIGN.md`: zero shadows, color-block sections, scale hover
  feedback, Outfit typography.

## Repository structure

```
apps/
  web/                      # Next.js app (frontend + REST route handlers + services)
    src/app/                #   pages: login, inbox, tickets/[id], kb, eval, api-docs
    src/app/api/            #   REST API route handlers
    src/lib/
      api/                  #   request/auth/error helpers
      rag/                  #   chunking, embeddings, hybrid retrieval, reranker
      copilot/              #   orchestration, guardrails, composer, rules, citations
      llm/                  #   provider adapter (openai-compatible + deterministic fallback)
      worker/               #   ingestion queue worker
      supabase/             #   server/browser/service clients
    tests/unit/             #   vitest unit tests
    tests/integration/      #   DB-backed integration tests (RLS, RPC, retrieval)
packages/
  shared/                   # zod contracts shared by app, worker, evaluation
  evaluation/               # golden dataset + eval suite + API e2e script
supabase/
  migrations/               # schema, RLS, functions (hybrid search, return RPC)
  seed.sql                  # deterministic demo data
scripts/
  fetch-ecr-image.mjs       # host-side registry fetch (offline/VM-broken fallback)
docs/                       # architecture, api, rag-pipeline, evaluation
infra: docker via Supabase CLI local stack; CI in .github/workflows/ci.yml
```

## Setup

Requirements: Node 20+, Docker Desktop, and the Supabase CLI
(`brew install supabase/tap/supabase` or use `npx supabase`, which is what the
repo scripts do).

```bash
# 1. Install dependencies
npm install

# 2. Start the local Supabase stack (Postgres+pgvector, Auth, Kong, PostgREST)
npm run db:start

# 3. Apply migrations + seed data
npm run db:reset

# 4. Copy the environment template and fill in the values printed by `supabase status`
cp .env.example apps/web/.env.local

# 5. Index the seeded policy documents (runs the ingestion worker once)
npm run seed:kb

# 6. Start the app (http://localhost:3000)
npm run dev
```

### Environment variables

Everything is documented in [.env.example](.env.example). Highlights:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — printed by `supabase status`
- `LLM_PROVIDER` = `mock` (default, deterministic) or `openai-compatible`
  (+ `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`)
- `EMBEDDING_PROVIDER` = `mock` (default) or `openai-compatible`
  (+ `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMS=1536`)
- `SUPPORT_AGENT_SCOPE` = `all` (default) or `assigned`
- Optional `RERANK_*` variables enable a Jina/Cohere-compatible reranker

**No external AI credentials are required**: in mock mode the copilot composes
answers deterministically from database facts + retrieved policy text, and
embeddings use a hashed bag-of-words vector (see *Limitations*).

### Demo credentials (development-only)

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@demo.local` | `demo1234` |
| Support agent | `agent@demo.local` | `demo1234` |
| Support agent 2 | `agent2@demo.local` | `demo1234` |
| Customer | `maria@example.com` | `demo1234` |
| Customer 2 | `devon@example.com` | `demo1234` |
| Customer 3 | `priya@example.com` | `demo1234` |

These are seeded non-sensitive local accounts. Never reuse them outside local
development; on a hosted Supabase project, create users via the Admin API and
set `app_metadata.role` server-side.

## Commands

```bash
npm run dev                 # Next.js dev server on :3000
npm run build               # production build
npm run lint                # eslint
npm run typecheck           # tsc for web + shared + evaluation

npm run db:start            # supabase start (local docker stack)
npm run db:reset            # apply migrations + seed from scratch
npm run db:status           # connection info and keys

npm run worker              # ingestion worker (drain queue and exit)
npm run seed:kb             # alias: index seeded policy docs (--once drain)

npm run test                # vitest unit tests (no DB required)
npm run test:integration    # vitest integration tests (requires db:start + db:reset)
npm run e2e                 # API end-to-end workflow (requires dev server + db)
npm run eval                # evaluation suite -> eval_runs table + results/latest.json
```

## API

REST endpoints are documented in [docs/api.md](docs/api.md) and served as an
OpenAPI 3.1 spec at `GET /api/openapi` with Swagger UI at `/api-docs`.
Authentication uses the session cookies from `POST /api/auth/login`; row-level
authorization is enforced by RLS inside PostgreSQL.

## Testing

- **Unit tests** (`npm run test`): heading-aware chunking, citation integrity
  (fabricated quotes/titles/chunks are dropped), deterministic return-eligibility
  rules, prompt-injection guardrails, deterministic composer outcomes, zod
  contracts, mock embedding determinism.
- **Integration tests** (`npm run test:integration`): RLS boundaries (customer
  vs agent vs anon, audit/job access, direct table writes blocked), the
  `app.create_return_request` RPC (ownership, idempotency, active-return
  uniqueness, audit rows), hybrid retrieval applicability filtering (superseded
  and draft versions are never returned), seed integrity.
- **API E2E** (`npm run e2e`): the full agent workflow — login → inbox → AI
  draft with citations → send reply → eligibility check → idempotent return
  creation → audit trail → customer ticket creation → authorization refusals.
- **Evaluation suite** (`npm run eval`): retrieval metrics (Recall@1/3, MRR),
  copilot behavior cases, citation validity, safety/authorization cases,
  tool-call correctness, latency. Writes `eval_runs` (shown in the /eval
  dashboard) plus `packages/evaluation/results/latest.json` and a markdown
  report. See [docs/evaluation.md](docs/evaluation.md).

## Known limitations

- **Mock embeddings are not semantic.** `EMBEDDING_PROVIDER=mock` produces
  hashed bag-of-words vectors. Retrieval quality numbers from the evaluation
  suite are lexical-overlap measurements, **not** real semantic-search
  performance. Configure an `openai-compatible` embedding endpoint for real
  vectors.
- **No real refunds / payments.** Return requests stop at `PENDING_REVIEW`;
  nothing moves money, by design.
- **Deterministic fallback instead of a mock LLM.** With `LLM_PROVIDER=mock`,
  drafts are template-composed from verified facts. Point the provider at an
  OpenAI-compatible gateway to enable generative drafts; the same validation and
  citation gates apply.
- **Ingestion worker runs as a CLI process.** In production you would run it as
  a scheduled job (Supabase Cron / Fly worker) against the same queue table.
- **Dataset is smoke-scale.** The golden dataset (8 retrieval + 8 behavior +
  8 safety + 5 tool-call cases) verifies the seeded content and the safety
  envelope; it is not a benchmark.
- Single-region, single-currency demo data; JWT claims can lag `app_metadata`
  changes until token refresh (the app reads roles from the live `profiles`
  row, which mitigates this).

See [docs/architecture.md](docs/architecture.md) for the full architecture,
[docs/rag-pipeline.md](docs/rag-pipeline.md) for the RAG design, and
[docs/evaluation.md](docs/evaluation.md) for metric definitions and the latest
measured results.
