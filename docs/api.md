# REST API

Base URL: `http://localhost:3000`. All responses use the envelope
`{ "data": … }` on success and `{ "error": { "code", "message", "details?" } }`
on failure. A machine-readable OpenAPI 3.1 description is served at
`GET /api/openapi` and rendered by Swagger UI at `/api-docs`.

Authentication = Supabase session cookies obtained from `POST /api/auth/login`
(`httpOnly`, same-site). Row-level authorization is enforced inside PostgreSQL
by RLS on top of the handler-level role checks described per endpoint.

## Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/login` | Sign in (`{ email, password }`), sets session cookies. 401 on bad credentials. |
| POST | `/api/auth/logout` | Sign out. |
| GET | `/api/auth/me` | Current user: `{ userId, email, role }` (401 when anonymous). |

## Orders (read-only)

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| GET | `/api/orders?page&pageSize&status` | any authenticated | Customers see only their own (RLS); staff see all. Paginated. |
| GET | `/api/orders/{id}` | owner / staff | Full detail: items + products, payment, shipments with events. 404 when not visible (RLS). |
| GET | `/api/orders/{id}/return-eligibility` | owner / staff | Deterministic eligibility: `ELIGIBLE \| NOT_ELIGIBLE \| INDETERMINATE` with reasons and missing information. |

The backend is authoritative: missing shipment estimates or payment outcomes
are returned as absent/null, never fabricated.

## Tickets and conversation

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| GET | `/api/tickets?status&category&priority&q&page&pageSize` | any authenticated | Inbox with repeatable `status`/`priority` filters, subject search. Agents see `SUPPORT_AGENT_SCOPE`-determined set (`all` default). |
| POST | `/api/tickets` | CUSTOMER | Creates ticket + first message; optional `orderNumber` is linked **only if it belongs to the caller**. |
| GET | `/api/tickets/{id}` | owner / staff | Detail: conversation, customer, order snapshot, payments, shipments + events, recent copilot runs. |
| PATCH | `/api/tickets/{id}` | ADMIN, SUPPORT_AGENT | Update status / priority / category / assignment. Audited. |
| PUT | `/api/tickets/{id}` | ADMIN, SUPPORT_AGENT | Explicit escalation to human review. Audited. |
| GET | `/api/tickets/{id}/messages` | owner / staff | Conversation timeline. |
| POST | `/api/tickets/{id}/messages` | owner (CUSTOMER msg) / staff (AGENT msg) | Send a reply; RLS rejects mismatches. Staff replies move OPEN → IN_PROGRESS. |

## Copilot

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| POST | `/api/tickets/{id}/draft` | ADMIN, SUPPORT_AGENT | Body `{ question? }` (defaults to the latest customer message). Runs the orchestration pipeline server-side and returns the run: `behavior`, `message`, validated `citations`, `missingInformation`, `suggestedNextActions`, `requiresHumanReview`, `provider`, `latencyMs`, `trace`. Persists the AI draft message + `copilot_runs` row. |

Outcomes: `ANSWER`, `PARTIAL_ANSWER`, `CLARIFY`, `ABSTAIN`, `ESCALATE`.
Citations reference either a retrieved policy chunk (with verbatim quote) or the
authorized order record (with field names). Fabricated citations are dropped
before persistence.

## Returns

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| GET | `/api/returns` | any authenticated | RLS-scoped list. |
| POST | `/api/returns` | owner / staff | Body `{ orderId, idempotencyKey, reason, itemIds?, eligibility? }`. Executed by `app.create_return_request` in one transaction: ownership + cancelled-order + active-return checks, idempotency via `unique(order_id, idempotency_key)`, audit row. Responses: `201` created, `200` idempotent replay (same request id), `403` not owner, `409` conflict. |

Return requests are created in `PENDING_REVIEW` only. **No refund is ever
executed** by this MVP.

## Knowledge base (admin = ADMIN; reads also for agents)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/kb/documents?status&category` | Versioned documents with status, effective dates, region, product category. |
| POST | `/api/kb/documents` | Create (starts as `DRAFT` at the next free version for title+region). |
| GET | `/api/kb/documents/{id}` | Detail incl. indexed chunks (heading, content, model, hash) and recent ingestion jobs. |
| PATCH | `/api/kb/documents/{id}` | Edit content/metadata; content changes re-queue ingestion. `status: ARCHIVED` supported. |
| POST | `/api/kb/documents/{id}/publish` | Publishes this version, supersedes the previously published one (sets `SUPERSEDED` + `effective_to`), queues ingestion. Audited. |
| POST | `/api/kb/documents/{id}/ingest` | Re-queue ingestion (202). |
| GET | `/api/kb/jobs?status` | Ingestion job statuses with attempts/errors (ADMIN). |

Only `PUBLISHED` + currently-effective versions are retrievable as policy
evidence — enforced in SQL inside `rag.hybrid_search`, not by the LLM.

## Admin / observability

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| GET | `/api/audit-logs?page&pageSize` | ADMIN | Newest-first audit feed. |
| GET | `/api/eval` | ADMIN, SUPPORT_AGENT | Latest evaluation run (results JSON + markdown report) or `null`. |

## Conventions

- **Pagination**: `page` (1-based) + `pageSize` (max 100); responses include
  `page`, `pageSize`, `total`.
- **Status codes**: 200 OK / 201 Created / 202 Accepted (queued) / 400
  INVALID_JSON / 401 UNAUTHENTICATED / 403 FORBIDDEN / 404 not found or
  RLS-invisible / 409 conflict / 422 VALIDATION_ERROR / 500 INTERNAL_ERROR
  (no stack traces in responses).
- **Validation**: request bodies are parsed with Zod; failures return 422 with
  flattened field errors.
- **Correlation IDs**: honored from `x-correlation-id` or generated per request
  and written into audit metadata.
