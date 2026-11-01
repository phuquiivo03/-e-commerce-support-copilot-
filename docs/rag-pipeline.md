# RAG Pipeline

## Document lifecycle (Feature D)

```
admin creates document (DRAFT)
        │  title, category, version, effective_from/to, region, product_category, content
        ▼
admin publishes  ──►  previous published version becomes SUPERSEDED
        │             (effective_to = new effective_from − 1 day, superseded_by set)
        ▼
ingestion job queued (ingestion_jobs, status=QUEUED)
        │
        ▼
worker claims job (FOR UPDATE SKIP LOCKED)
  1. refuse unless status = PUBLISHED  (job fails otherwise)
  2. heading-aware chunking (configurable token size + overlap)
  3. embed chunks via the embedding adapter
  4. ONE transaction: delete old chunks, insert new ones
        │
        ├─ success → job SUCCEEDED
        └─ failure → attempts < max_attempts ? back to QUEUED : FAILED (error recorded)
```

A failed job can never leave a document half-indexed: chunk replacement is
transactional, and the previous chunks stay until the new set commits. The
document itself carries no "ready" flag that could go stale — applicability is
computed from status + effective dates at query time.

### Document applicability (SQL, not LLM judgment)

`rag.hybrid_search` restricts candidates to documents where:

```sql
status = 'PUBLISHED'
AND effective_from <= current_date
AND (effective_to IS NULL OR effective_to >= current_date)
AND (category filter)
AND (region filter)
AND (product_category IS NULL OR matches requested OR is general)
```

Expired, superseded, and draft versions are therefore structurally unreachable
as policy evidence. The seed data deliberately includes a superseded
Returns v1 ("60 days"), a draft v3 ("45 days"), and an expired Shipping v1 to
keep this honest and testable.

## Chunking

`lib/rag/chunking.ts` splits on markdown headings (`##`–`####`), then packs
paragraphs into chunks of at most `INGESTION_CHUNK_TOKENS` (default 180,
~4 chars/token) with `INGESTION_CHUNK_OVERLAP_TOKENS` (default 30) carried
between consecutive chunks of the same section. Oversized single paragraphs
become their own chunk. Each chunk stores its heading, which is prepended to
the embedding input and shown in the UI.

## Embedding adapters

| Provider | Behavior |
| --- | --- |
| `openai-compatible` | `POST {EMBEDDING_BASE_URL}/embeddings` with `EMBEDDING_MODEL`, dims ≤ `EMBEDDING_DIMS`. 30s timeout. |
| `mock` (default) | Deterministic hashed bag-of-words vector (unigrams + bigrams, signed hashing, L2-normalized) from `@copilot/shared` — the exact same function the evaluation suite uses. |

**The mock adapter is not a semantic embedding model.** It produces lexical
token-overlap geometry so the whole pipeline runs offline and deterministically;
retrieval scores under mock mode must never be presented as semantic-search
quality.

## Hybrid retrieval

`rag.hybrid_search` (private `rag` schema, `service_role` only) fuses:

- **PostgreSQL full-text search** — `to_tsvector('english', content)` (stored
  generated column, GIN index) matched with `websearch_to_tsquery`
- **pgvector cosine** — HNSW index (`vector_cosine_ops`) on
  `kb_chunks.embedding vector(1536)`

Each side produces a top-50 ranking; Reciprocal Rank Fusion with k=60 combines
them: `score = Σ 1/(60 + rank)`. Both per-source ranks are returned so the
trace can show whether a chunk matched lexically, semantically, or both.

An optional reranker (Jina/Cohere-compatible `/rerank`) can be enabled via
`RERANK_*` env vars. It can only **reorder** retrieved chunks — it can never
introduce chunks that retrieval did not return, and failures fall back to
retrieval order.

## Copilot orchestration (Feature E)

For `POST /api/tickets/{id}/draft` (staff only):

1. **Authenticate + load authorized context** — ticket, customer, conversation.
2. **Guardrails** — deterministic injection-pattern detection and
   human-agent-request detection over the question.
3. **Classify/extract** — ticket category (authoritative) maps to KB
   categories; `orderSpecific` intent detection; `ORD-\d+` references are only
   *hints* and must resolve to the ticket customer's own order.
4. **Structured data** — order, items, payment, shipments, latest event via
   service-role queries scoped to the ticket's customer.
5. **Retrieve policy evidence** — hybrid search restricted by category/region/
   product-category; rerank if configured.
6. **Deterministic business rules** — return eligibility for RETURNS tickets
   (pure function; `INDETERMINATE` when inputs are missing).
7. **Evidence sufficiency + compose** — outcome chosen by deterministic rules:
   - `ESCALATE` — injection attempt requesting an action, or explicit request
     for a human (`requiresHumanReview = true`)
   - `CLARIFY` — essential info missing (e.g. order-specific question, no
     order resolvable)
   - `ABSTAIN` — neither policy evidence nor structured data
   - `PARTIAL_ANSWER` — one side missing but an honest partial answer exists
   - `ANSWER` — verified facts + applicable policy
   The LLM path (when configured) drafts wording + citations inside these
   guardrails; mock mode composes templates from facts and verbatim policy
   quotes.
8. **Citation validation** — every citation must reference a retrieved chunk
   (title/version match + quote appears verbatim in the chunk) or the
   authorized order record (real fields only). Invalid citations are dropped;
   an `ANSWER` with zero valid citations is downgraded.
9. **Persist** — `copilot_runs` (outcome, message, citations, missing info,
   next actions, trace, latency, provider) + `AI_DRAFT` ticket message.

The LLM provider adapter (`openai-compatible`) uses JSON-mode output validated
by `CopilotResponseSchema` (Zod), temperature 0, 20s timeout, one retry on
transient failures; any provider error or malformed output falls back to the
deterministic composer — never to an unpersisted or unvalidated draft.

## Return eligibility rules (Feature F)

Pure function over database facts; mirrors the published Returns & Exchanges
Policy v2 (constants documented in `lib/copilot/rules/returns.ts`):

- order must be `DELIVERED` and have a recorded delivery date, else
  `INDETERMINATE` (never guessed)
- per item: non-returnable product (final sale / gift card) → ineligible
- per item: window by category — Electronics 14 days, default 30 days — from
  delivery date; deadline reported as a date
- any active return request (`PENDING_REVIEW`/`APPROVED`) → ineligible
  duplicate
- mixed carts report per-item outcomes; `ELIGIBLE` when at least one item is
  returnable

Creation is separate from eligibility and from refunds: the RPC re-checks
ownership and duplicates inside the transaction (client-supplied eligibility is
audit metadata only, never authorization).
