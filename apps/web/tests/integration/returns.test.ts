import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AGENT, MARIA, asUser, serviceClient } from './helpers';

/**
 * Return-request workflow: ownership enforcement, idempotency under replay,
 * active-return uniqueness, and audit rows — through the
 * app.create_return_request RPC with real user JWTs.
 */
describe('return request workflow (RPC)', () => {
  it('creates a return request and replays idempotently', async () => {
    const agent = await asUser(AGENT);
    const { data: order } = await serviceClient
      .from('orders')
      .select('id')
      .eq('order_number', 'ORD-2001')
      .limit(1);

    const key = `itest-${Date.now()}`;
    const first = await agent.rpc('create_return_request', {
      p_order_id: order![0]!.id,
      p_idempotency_key: key,
      p_reason: 'integration test return',
    });
    expect(first.error).toBeNull();
    expect(first.data.created).toBe(true);

    const replay = await agent.rpc('create_return_request', {
      p_order_id: order![0]!.id,
      p_idempotency_key: key,
      p_reason: 'integration test return',
    });
    expect(replay.error).toBeNull();
    expect(replay.data.created).toBe(false);
    expect(replay.data.return_request.id).toBe(first.data.return_request.id);

    const { data: rows } = await serviceClient
      .from('return_requests')
      .select('id')
      .eq('order_id', order![0]!.id)
      .eq('idempotency_key', key);
    expect(rows).toHaveLength(1);

    // Audit row recorded for the creation only.
    const { data: auditRows } = await serviceClient
      .from('audit_logs')
      .select('id, metadata')
      .eq('action', 'return_request.created')
      .order('created_at', { ascending: false })
      .limit(5);
    expect(auditRows?.some((r) => r.metadata?.idempotency_key === key)).toBe(true);
  });

  it("rejects a customer creating a return for someone else's order", async () => {
    const maria = await asUser(MARIA);
    const { data: devonOrder } = await serviceClient
      .from('orders')
      .select('id')
      .eq('order_number', 'ORD-2001')
      .limit(1);
    const result = await maria.rpc('create_return_request', {
      p_order_id: devonOrder![0]!.id,
      p_idempotency_key: `itest-cross-${Date.now()}`,
      p_reason: 'not my order',
    });
    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain('FORBIDDEN');
  });

  it('rejects a second active return on the same order', async () => {
    const agent = await asUser(AGENT);
    const { data: order } = await serviceClient
      .from('orders')
      .select('id')
      .eq('order_number', 'ORD-1005')
      .limit(1); // has a seeded PENDING_REVIEW return
    const result = await agent.rpc('create_return_request', {
      p_order_id: order![0]!.id,
      p_idempotency_key: `itest-dup-${Date.now()}`,
      p_reason: 'duplicate active return attempt',
    });
    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain('RETURN_ALREADY_ACTIVE');
  });

  it('rejects unauthenticated calls', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { SUPABASE_URL, ANON_KEY } = await import('./helpers');
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const result = await anon.rpc('create_return_request', {
      p_order_id: crypto.randomUUID(),
      p_idempotency_key: `itest-anon-${Date.now()}`,
      p_reason: 'anonymous attempt',
    });
    expect(result.error).not.toBeNull();
  });

  it('uses unique constraints as the last line of defense', async () => {
    // The unique(order_id, idempotency_key) constraint must exist.
    const { data: order } = await serviceClient
      .from('orders')
      .select('id')
      .eq('order_number', 'ORD-1002')
      .limit(1);
    const key = `itest-uc-${createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 10)}`;
    const agent = await asUser(AGENT);
    await agent.rpc('create_return_request', {
      p_order_id: order![0]!.id,
      p_idempotency_key: key,
      p_reason: 'constraint check one',
    });
    const { count } = await serviceClient
      .from('return_requests')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);
  });
});
