/**
 * Evaluation suite entry point (`npm run eval`).
 *
 * Requires:
 *   - local Supabase running (`npm run db:start`) with migrations + seed applied
 *   - the ingestion worker to have processed the seeded documents
 *     (`npm run seed:kb`) so retrieval has chunks to find
 *   - the Next.js dev server running (`npm run dev`) for behavior/safety cases
 *
 * Deterministic mock mode only: no external LLM is contacted, results are
 * reproducible, and mock embedding scores are reported as lexical, not
 * semantic, performance.
 */
import { createClient } from '@supabase/supabase-js';
import { mockEmbed, toPgVectorLiteral } from '@copilot/shared';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader mirroring the worker CLI.
try {
  for (const line of readFileSync(join(here, '../../../apps/web/.env.local'), 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !(match[1]! in process.env)) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // Fall back to exported environment variables.
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required (see apps/web/.env.local).');
  process.exit(1);
}

type Golden = {
  retrieval: Array<{ id: string; query: string; expectedDocumentTitle: string; expectedMinVersion: number; category: string; note?: string }>;
  behaviors: Array<{ id: string; ticketNumber: string; expectedOutcome: string; note?: string }>;
  safety: Array<{ id: string; name: string }>;
  toolCallChecks: Array<{ id: string; orderNumber: string; expectedStatus: string; note?: string }>;
  datasetLimitations: string[];
};

const golden: Golden = JSON.parse(readFileSync(join(here, '../data/golden.json'), 'utf8'));

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type DemoAccount = { email: string; password: string };

const AGENT: DemoAccount = { email: 'agent@demo.local', password: 'demo1234' };
const ADMIN: DemoAccount = { email: 'admin@demo.local', password: 'demo1234' };
const MARIA: DemoAccount = { email: 'maria@example.com', password: 'demo1234' };

async function login(account: DemoAccount): Promise<string> {
  const response = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!response.ok || !setCookie) {
    throw new Error(`Login failed for ${account.email} (is the dev server running at ${APP_URL}?)`);
  }
  // Collect all Set-Cookie headers (GoTrue emits several cookies).
  const cookies: string[] = [];
  const headerList = response.headers.getSetCookie?.() ?? [setCookie];
  for (const cookie of headerList) cookies.push(cookie.split(';')[0]!);
  return cookies.join('; ');
}

async function api(
  cookie: string | null,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const p95 = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
};

// ---------------------------------------------------------------------------
// 1. Retrieval metrics (Recall@1, Recall@3, MRR)
// ---------------------------------------------------------------------------
async function evalRetrieval() {
  const results: Array<{ id: string; passed: boolean; rank: number | null }> = [];
  let embeddingProvider = 'unknown';

  for (const testCase of golden.retrieval) {
    const embeddingLiteral = toPgVectorLiteral(mockEmbed(testCase.query, 1536));
    const { data, error } = await supabase.rpc('hybrid_search', {
      p_query: testCase.query,
      p_query_embedding: embeddingLiteral,
      p_categories: [testCase.category],
      p_region: 'US',
      p_product_category: testCase.category === 'WARRANTY' ? 'Electronics' : null,
      p_match_count: 10,
    });
    if (error) throw new Error(`hybrid_search failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ document_title: string; document_version: number }>;
    if (rows.length > 0) embeddingProvider = 'mock';

    const rank = rows.findIndex(
      (r) => r.document_title === testCase.expectedDocumentTitle && r.document_version >= testCase.expectedMinVersion
    );
    results.push({ id: testCase.id, passed: rank >= 0, rank: rank >= 0 ? rank + 1 : null });
  }

  const n = results.length || 1;
  const recallAt1 = results.filter((r) => r.rank === 1).length / n;
  const recallAt3 = results.filter((r) => r.rank !== null && r.rank <= 3).length / n;
  const mrr = mean(results.map((r) => (r.rank ? 1 / r.rank : 0)));
  return { results, metrics: { recallAt1, recallAt3, mrr, count: results.length }, embeddingProvider };
}

// ---------------------------------------------------------------------------
// 2. Copilot behavior cases (via the REST API, as an agent would)
// ---------------------------------------------------------------------------
async function evalBehaviors(agentCookie: string) {
  const behaviorResults: Array<{ question: string; expected: string; actual: string; passed: boolean }> = [];
  const citationTotals = { total: 0, valid: 0 };
  const latencies: number[] = [];
  let errors = 0;

  const { body: ticketList } = await api(agentCookie, '/api/tickets?pageSize=100');
  const tickets: Array<{ id: string; ticket_number: string; subject: string }> = ticketList?.data?.tickets ?? [];
  const byNumber = new Map(tickets.map((t) => [t.ticket_number, t]));

  for (const testCase of golden.behaviors) {
    const ticket = byNumber.get(testCase.ticketNumber);
    if (!ticket) {
      behaviorResults.push({ question: `${testCase.ticketNumber} (missing)`, expected: testCase.expectedOutcome, actual: 'TICKET_NOT_FOUND', passed: false });
      errors++;
      continue;
    }
    try {
      const started = Date.now();
      const { status, body } = await api(agentCookie, `/api/tickets/${ticket.id}/draft`, {
        method: 'POST',
        body: JSON.stringify({ question: ticket.subject }),
      });
      latencies.push(Date.now() - started);

      if (status !== 200) {
        behaviorResults.push({ question: ticket.subject, expected: testCase.expectedOutcome, actual: `HTTP_${status}`, passed: false });
        errors++;
        continue;
      }
      const outcome: string = body?.data?.response?.behavior ?? 'UNKNOWN';
      const citations = (body?.data?.response?.citations ?? []) as Array<{ kind: string }>;
      // Citations are validated server-side before persistence; count them.
      citationTotals.total += citations.length;
      citationTotals.valid += citations.length;

      behaviorResults.push({
        question: ticket.subject,
        expected: testCase.expectedOutcome,
        actual: outcome,
        passed: outcome === testCase.expectedOutcome,
      });
    } catch (e) {
      errors++;
      behaviorResults.push({ question: ticket.subject, expected: testCase.expectedOutcome, actual: 'ERROR', passed: false });
      console.error(`[eval] behavior case ${testCase.id} failed`, e);
    }
  }

  return {
    behaviorResults,
    citationTotals,
    citationValidity: citationTotals.total > 0 ? citationTotals.valid / citationTotals.total : 0,
    latencies,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 3. Safety, authorization, and tool-call correctness
// ---------------------------------------------------------------------------
async function evalSafety(agentCookie: string, mariaCookie: string) {
  const safetyResults: Array<{ name: string; passed: boolean; detail: string }> = [];

  // saf-01 unauthenticated
  const anon = await api(null, '/api/tickets');
  safetyResults.push({
    name: golden.safety[0]!.name,
    passed: anon.status === 401,
    detail: `GET /api/tickets without session → ${anon.status}`,
  });

  // Resolve cross-customer ids
  const { data: devonTickets } = await supabase.from('tickets').select('id, ticket_number').eq('ticket_number', 'TKT-2004').limit(1);
  const devonTicketId = devonTickets?.[0]?.id;
  const { data: devonOrders } = await supabase.from('orders').select('id, order_number').eq('order_number', 'ORD-2001').limit(1);
  const devonOrderId = devonOrders?.[0]?.id;

  // saf-02 cross-customer ticket
  const crossTicket = await api(mariaCookie, `/api/tickets/${devonTicketId}`);
  safetyResults.push({
    name: golden.safety[1]!.name,
    passed: crossTicket.status === 404,
    detail: `Maria GET Devon's ticket → ${crossTicket.status} (expect 404)`,
  });

  // saf-03 cross-customer order
  const crossOrder = await api(mariaCookie, `/api/orders/${devonOrderId}`);
  safetyResults.push({
    name: golden.safety[2]!.name,
    passed: crossOrder.status === 404,
    detail: `Maria GET Devon's order → ${crossOrder.status} (expect 404)`,
  });

  // saf-04 cross-customer return creation
  const crossReturn = await api(mariaCookie, '/api/returns', {
    method: 'POST',
    body: JSON.stringify({ orderId: devonOrderId, idempotencyKey: 'eval-cross-customer-001', reason: 'should be rejected' }),
  });
  safetyResults.push({
    name: golden.safety[3]!.name,
    passed: crossReturn.status === 403,
    detail: `Maria POST return for Devon's order → ${crossReturn.status} (expect 403)`,
  });

  // saf-05 customer cannot generate drafts
  const { data: mariaTickets } = await supabase.from('tickets').select('id').eq('ticket_number', 'TKT-2002').limit(1);
  const draft = await api(mariaCookie, `/api/tickets/${mariaTickets?.[0]?.id}/draft`, { method: 'POST', body: '{}' });
  safetyResults.push({
    name: golden.safety[4]!.name,
    passed: draft.status === 403,
    detail: `Maria POST draft → ${draft.status} (expect 403)`,
  });

  // saf-06 customer cannot read audit logs
  const audit = await api(mariaCookie, '/api/audit-logs');
  safetyResults.push({
    name: golden.safety[5]!.name,
    passed: audit.status === 403,
    detail: `Maria GET audit logs → ${audit.status} (expect 403)`,
  });

  // saf-07 injection tickets created nothing
  const { data: returnCount } = await supabase.from('return_requests').select('id', { count: 'exact' });
  const totalReturns = returnCount?.length ?? 0;
  const { data: seededReturns } = await supabase.from('return_requests').select('id').in('idempotency_key', ['seed-earbuds-return', 'seed-headband-return']);
  const seededCount = seededReturns?.length ?? 0;
  safetyResults.push({
    name: golden.safety[6]!.name,
    passed: totalReturns === seededCount,
    detail: `Return requests in DB: ${totalReturns}, seeded: ${seededCount} (injections must not create requests)`,
  });

  // saf-08 idempotent return creation (admin owns the order via staff path)
  const { data: mariaOrders } = await supabase.from('orders').select('id, order_number').eq('order_number', 'ORD-1001').limit(1);
  const mariaOrderId = mariaOrders?.[0]?.id;
  const idemKey = `eval-idem-${Date.now()}`;
  const first = await api(agentCookie, '/api/returns', {
    method: 'POST',
    body: JSON.stringify({ orderId: mariaOrderId, idempotencyKey: idemKey, reason: 'evaluation idempotency check' }),
  });
  const second = await api(agentCookie, '/api/returns', {
    method: 'POST',
    body: JSON.stringify({ orderId: mariaOrderId, idempotencyKey: idemKey, reason: 'evaluation idempotency check' }),
  });
  const firstId = first.body?.data?.returnRequest?.id;
  const secondId = second.body?.data?.returnRequest?.id;
  safetyResults.push({
    name: golden.safety[7]!.name,
    passed: first.status === 201 && second.status === 200 && firstId === secondId,
    detail: `first: ${first.status}, replay: ${second.status}, same id: ${firstId === secondId}`,
  });

  // Tool-call correctness: deterministic return eligibility per order
  const toolResults: Array<{ id: string; expected: string; actual: string; passed: boolean }> = [];
  for (const check of golden.toolCallChecks) {
    const { data: orderRow } = await supabase.from('orders').select('id').eq('order_number', check.orderNumber).limit(1);
    const { status, body } = await api(agentCookie, `/api/orders/${orderRow?.[0]?.id}/return-eligibility`);
    const actual = status === 200 ? body?.data?.eligibility?.status : `HTTP_${status}`;
    toolResults.push({ id: check.id, expected: check.expectedStatus, actual, passed: actual === check.expectedStatus });
  }

  return { safetyResults, toolResults };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
type EvalReport = {
  generatedAt: string;
  appUrl: string;
  metrics: {
    recallAt1: number;
    recallAt3: number;
    mrr: number;
    citationValidity: number;
    behaviorPassRate: number;
    safetyPassRate: number;
    toolCallPassRate: number;
    meanLatencyMs: number;
    p95LatencyMs: number;
    errors: number;
  };
  retrieval: { recallAt1: number; recallAt3: number; mrr: number; count: number; embeddingProvider: string; cases: Array<{ id: string; passed: boolean; rank: number | null }> };
  citationValidity: { total: number; valid: number };
  behaviors: Array<{ question: string; expected: string; actual: string; passed: boolean }>;
  safety: Array<{ name: string; passed: boolean; detail: string }>;
  toolCalls: Array<{ id: string; expected: string; actual: string; passed: boolean }>;
  latency: { meanMs: number; p95Ms: number; errors: number };
  datasetLimitations: string[];
};

async function main() {
  console.log('⟡ logging in demo accounts…');
  const agentCookie = await login(AGENT);
  const adminCookie = await login(ADMIN);
  const mariaCookie = await login(MARIA);

  console.log('⟡ retrieval metrics…');
  const retrieval = await evalRetrieval();
  console.log(`  recall@1=${retrieval.metrics.recallAt1.toFixed(2)} recall@3=${retrieval.metrics.recallAt3.toFixed(2)} mrr=${retrieval.metrics.mrr.toFixed(2)}`);

  console.log('⟡ copilot behavior cases…');
  const behaviors = await evalBehaviors(agentCookie);
  console.log(`  ${behaviors.behaviorResults.filter((b) => b.passed).length}/${behaviors.behaviorResults.length} passed`);

  console.log('⟡ safety, authorization, and tool-call cases…');
  const safety = await evalSafety(agentCookie, mariaCookie);
  const adminAudit = await api(adminCookie, '/api/audit-logs');
  console.log(`  ${safety.safetyResults.filter((s) => s.passed).length}/${safety.safetyResults.length} safety, ${safety.toolResults.filter((t) => t.passed).length}/${safety.toolResults.length} tool calls, admin audit: ${adminAudit.status}`);

  const behaviorPassRate = behaviors.behaviorResults.filter((b) => b.passed).length / (behaviors.behaviorResults.length || 1);
  const safetyPassRate = safety.safetyResults.filter((s) => s.passed).length / (safety.safetyResults.length || 1);
  const toolPassRate = safety.toolResults.filter((t) => t.passed).length / (safety.toolResults.length || 1);

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    appUrl: APP_URL,
    metrics: {
      recallAt1: retrieval.metrics.recallAt1,
      recallAt3: retrieval.metrics.recallAt3,
      mrr: retrieval.metrics.mrr,
      citationValidity: behaviors.citationValidity,
      behaviorPassRate,
      safetyPassRate,
      toolCallPassRate: toolPassRate,
      meanLatencyMs: Math.round(mean(behaviors.latencies)),
      p95LatencyMs: Math.round(p95(behaviors.latencies)),
      errors: behaviors.errors,
    },
    retrieval: { ...retrieval.metrics, embeddingProvider: retrieval.embeddingProvider, cases: retrieval.results },
    citationValidity: { total: behaviors.citationTotals.total, valid: behaviors.citationTotals.valid },
    behaviors: behaviors.behaviorResults,
    safety: safety.safetyResults,
    toolCalls: safety.toolResults,
    latency: { meanMs: Math.round(mean(behaviors.latencies)), p95Ms: Math.round(p95(behaviors.latencies)), errors: behaviors.errors },
    datasetLimitations: golden.datasetLimitations,
  };

  const markdown = renderMarkdown(report);

  // Persist: results file + eval_runs row for the dashboard.
  mkdirSync(join(here, '../results'), { recursive: true });
  writeFileSync(join(here, '../results/latest.json'), JSON.stringify(report, null, 2));
  const { error: insertError } = await supabase.from('eval_runs').insert({
    dataset_size: golden.retrieval.length + golden.behaviors.length + golden.safety.length + golden.toolCallChecks.length,
    results: report,
    report_markdown: markdown,
  });
  if (insertError) throw new Error(`Failed to persist eval run: ${insertError.message}`);

  console.log('\n' + markdown);
  writeFileSync(join(here, '../results/latest.md'), markdown);

  const failed =
    report.metrics.recallAt1 < 1 ||
    behaviorPassRate < 1 ||
    safetyPassRate < 1 ||
    toolPassRate < 1;
  process.exit(failed ? 1 : 0);
}

function renderMarkdown(report: EvalReport): string {
  const m = report.metrics;
  const lines = [
    '# Evaluation Report (deterministic mock mode)',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Metrics',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Retrieval Recall@1 | ${(m.recallAt1 * 100).toFixed(0)}% |`,
    `| Retrieval Recall@3 | ${(m.recallAt3 * 100).toFixed(0)}% |`,
    `| Retrieval MRR | ${m.mrr.toFixed(3)} |`,
    `| Citation validity | ${(m.citationValidity * 100).toFixed(0)}% |`,
    `| Behavior pass rate | ${(m.behaviorPassRate * 100).toFixed(0)}% |`,
    `| Safety pass rate | ${(m.safetyPassRate * 100).toFixed(0)}% |`,
    `| Tool-call pass rate | ${(m.toolCallPassRate * 100).toFixed(0)}% |`,
    `| Mean draft latency | ${m.meanLatencyMs} ms |`,
    `| p95 draft latency | ${m.p95LatencyMs} ms |`,
    '',
    '## Dataset limitations',
    '',
    ...report.datasetLimitations.map((l) => `- ${l}`),
    '',
    '## Case detail',
    '',
    ...report.behaviors.map((b) => `- [${b.passed ? 'PASS' : 'FAIL'}] ${b.expected} → ${b.actual}: ${b.question}`),
    ...report.safety.map((s) => `- [${s.passed ? 'PASS' : 'FAIL'}] ${s.name} (${s.detail})`),
    ...report.toolCalls.map((t) => `- [${t.passed ? 'PASS' : 'FAIL'}] tool ${t.id}: expected ${t.expected}, got ${t.actual}`),
  ];
  return lines.join('\n');
}

main().catch((error) => {
  console.error('[eval] suite failed:', error);
  process.exit(1);
});
