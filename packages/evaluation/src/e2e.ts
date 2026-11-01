/**
 * End-to-end workflow test (`npm run e2e`) — exercises the critical agent
 * workflow over the REST API against a running stack:
 *
 *   agent login → inbox → ticket detail → AI draft with citations →
 *   edit & send reply → return eligibility → idempotent return creation →
 *   audit trail check → customer login → create ticket → agent replies
 *
 * Exits non-zero on the first failed assertion.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
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
  console.error('SUPABASE_SERVICE_ROLE_KEY is required.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let failures = 0;
function assert(condition: boolean, label: string, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  });
  const cookies: string[] = [];
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    cookies.push(cookie.split(';')[0]!);
  }
  if (!response.ok || cookies.length === 0) throw new Error(`Login failed for ${email}`);
  return cookies.join('; ');
}

async function api(cookie: string | null, path: string, init: RequestInit = {}) {
  const response = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function main() {
  console.log('E2E: agent workflow\n');

  // 1. Agent login + ticket list
  const agentCookie = await login('agent@demo.local');
  const { body: inbox } = await api(agentCookie, '/api/tickets?pageSize=50');
  assert(inbox?.data?.tickets?.length > 0, 'agent sees the ticket inbox');

  // 2. Open the returns ticket and generate a draft
  const ticket = inbox.data.tickets.find((t: { ticket_number: string }) => t.ticket_number === 'TKT-2002');
  assert(Boolean(ticket), 'returns ticket TKT-2002 is in the inbox');

  const draft = await api(agentCookie, `/api/tickets/${ticket.id}/draft`, { method: 'POST', body: '{}' });
  assert(draft.status === 200, 'AI draft generated', `status ${draft.status}`);
  assert(
    ['ANSWER', 'PARTIAL_ANSWER', 'CLARIFY', 'ESCALATE'].includes(draft.body?.data?.response?.behavior),
    'draft has a valid outcome',
    JSON.stringify(draft.body?.data?.response?.behavior)
  );
  const citations = draft.body?.data?.response?.citations ?? [];
  assert(
    citations.length > 0 && citations.some((c: { kind: string }) => c.kind === 'order_record'),
    'draft cites the order record',
    `${citations.length} citations`
  );

  // 3. Send the reply (edits the draft copy slightly, as an agent would)
  const reply = await api(agentCookie, `/api/tickets/${ticket.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: `${draft.body.data.response.message}\n\n— Sam (edited before sending)` }),
  });
  assert(reply.status === 201, 'agent reply sent', `status ${reply.status}`);

  // 4. Return eligibility + idempotent creation
  const { data: orderRow } = await supabase.from('orders').select('id').eq('order_number', 'ORD-1001').limit(1);
  const eligibility = await api(agentCookie, `/api/orders/${orderRow?.[0]?.id}/return-eligibility`);
  assert(eligibility.body?.data?.eligibility?.status === 'ELIGIBLE', 'return eligibility is ELIGIBLE for ORD-1001');

  const idempotencyKey = `e2e-${Date.now()}`;
  const first = await api(agentCookie, '/api/returns', {
    method: 'POST',
    body: JSON.stringify({ orderId: orderRow?.[0]?.id, idempotencyKey, reason: 'e2e workflow return' }),
  });
  const replay = await api(agentCookie, '/api/returns', {
    method: 'POST',
    body: JSON.stringify({ orderId: orderRow?.[0]?.id, idempotencyKey, reason: 'e2e workflow return' }),
  });
  assert(first.status === 201, 'return request created');
  assert(replay.status === 200 && replay.body?.data?.returnRequest?.id === first.body?.data?.returnRequest?.id, 'replay is idempotent (same request id)');

  // 5. Audit trail recorded the creation
  const audit = await api(agentCookie, '/api/audit-logs?pageSize=10');
  assert(audit.status === 403 || audit.status === 200, 'audit endpoint responds for staff/admin');
  const { data: auditRows } = await supabase
    .from('audit_logs')
    .select('id, action')
    .eq('action', 'return_request.created')
    .limit(50);
  assert(
    (auditRows ?? []).some((row: { action: string }) => row.action === 'return_request.created'),
    'return creation appears in the audit log'
  );

  // 6. Customer creates a ticket; agent replies
  const mariaCookie = await login('maria@example.com');
  const created = await api(mariaCookie, '/api/tickets', {
    method: 'POST',
    body: JSON.stringify({
      subject: 'E2E: question about my mug set',
      body: 'The mugs from my order arrived — can I exchange one?',
      category: 'RETURNS',
      priority: 'LOW',
      orderNumber: 'ORD-1001',
    }),
  });
  assert(created.status === 201, 'customer ticket created', `status ${created.status}`);

  const agentReply = await api(agentCookie, `/api/tickets/${created.body?.data?.ticket?.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Thanks! I can help with an exchange — let me check the order.' }),
  });
  assert(agentReply.status === 201, 'agent replied to the new ticket');

  // 7. Customer cannot see Devon's tickets (authorization boundary)
  const { data: devonTicket } = await supabase.from('tickets').select('id').eq('ticket_number', 'TKT-2004').limit(1);
  const forbidden = await api(mariaCookie, `/api/tickets/${devonTicket?.[0]?.id}`);
  assert(forbidden.status === 404, "customer cannot read another customer's ticket", `status ${forbidden.status}`);

  console.log(failures === 0 ? '\nAll E2E assertions passed.' : `\n${failures} E2E assertion(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[e2e] failed:', error);
  process.exit(1);
});
