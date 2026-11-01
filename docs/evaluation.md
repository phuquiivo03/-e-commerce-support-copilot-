# Evaluation

Run with `npm run eval` (requires the local Supabase stack with migrations +
seed, the ingestion worker to have indexed the seeded policies via
`npm run seed:kb`, and the dev server on :3000).

The suite (`packages/evaluation`) is fully deterministic: it uses the mock
embedding adapter and the deterministic copilot mode, so results are
reproducible run-to-run with no external AI calls and no API cost.

## Golden dataset

Version-controlled at `packages/evaluation/data/golden.json`:

- **8 retrieval cases** — natural policy questions with the expected document
  title and minimum version (e.g. the "60 days" question must retrieve
  Returns **v2**, proving superseded v1 is excluded)
- **8 behavior cases** — seeded tickets with the expected copilot outcome
  (ANSWER / ESCALATE), covering returns inside/outside the window, shipment
  status, refund timing, order status, warranty, and two prompt-injection
  tickets
- **8 safety cases** — unauthenticated access, cross-customer ticket/order
  reads, cross-customer return creation, customer role restrictions (drafts,
  audit logs), injection must not create returns/refunds, return idempotency
- **5 tool-call checks** — deterministic return-eligibility results per order
  (ELIGIBLE / NOT_ELIGIBLE / INDETERMINATE)

## Metric definitions

| Metric | Definition |
| --- | --- |
| Recall@1 | Share of retrieval cases whose expected applicable policy chunk ranks first |
| Recall@3 | Share of retrieval cases whose expected chunk ranks in the top 3 |
| MRR | Mean of 1/rank of the expected chunk across retrieval cases |
| Citation validity | Persisted citations that passed server-side validation / total citations (the server drops invalid ones, so this also measures the pipeline's refusal rate) |
| Behavior pass rate | Behavior cases whose observed outcome equals the expected outcome |
| Safety pass rate | Safety cases passed (API-level authorization + injection containment + idempotency) |
| Tool-call pass rate | Eligibility checks matching the rule-derived expectation |
| Latency | Mean and p95 wall-clock of draft generation; errors counted separately |

Evidence sufficiency is **not** judged by LLM confidence anywhere: outcomes are
compared against deterministic expectations.

## Latest results

Measured 2026-10-30, deterministic mock mode, dataset size 29 cases:

| Metric | Value |
| --- | --- |
| Retrieval Recall@1 | 100% (8/8) |
| Retrieval Recall@3 | 100% (8/8) |
| Retrieval MRR | 1.000 |
| Citation validity | 100% (17/17 citations valid) |
| Behavior pass rate | 100% (8/8) |
| Safety pass rate | 100% (8/8) |
| Tool-call pass rate | 100% (5/5) |
| Mean draft latency | ~5 ms (deterministic mode; no LLM/network) |
| p95 draft latency | ~6 ms |
| Errors | 0 |

Interpretation notes: these numbers verify the pipeline against the seeded
policies and rules in deterministic mode. With a real embedding model and a
generative LLM configured, retrieval and behavior scores are expected to change
and must be re-measured — do not extrapolate the mock-mode numbers to that
configuration.

## Dataset limitations

- Smoke-scale (29 cases) and tied to the seeded content; it verifies behavior
  and safety boundaries, it is not a benchmark of model quality.
- Mock embeddings measure lexical overlap, not semantic retrieval quality.
- Behavior expectations depend on seeded relative dates; `supabase db reset`
  keeps them valid, but edited seed data requires dataset updates.
- The eval suite exercises the REST boundary + deterministic guardrails; it
  does not fuzz a generative model (none is configured in mock mode).

## Where results go

- `eval_runs` table (visible in the `/eval` dashboard for staff)
- `packages/evaluation/results/latest.json` (gitignored, machine-readable)
- `packages/evaluation/results/latest.md` (markdown report, also printed)

`npm run e2e` additionally runs the critical-workflow end-to-end script (login →
inbox → draft → send → returns idempotency → audit trail → authorization
refusals) with assertions; it exits non-zero on failure.
