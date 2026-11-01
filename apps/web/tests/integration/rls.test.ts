import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { AGENT, ANON_KEY, DEVON, MARIA, SUPABASE_URL, asUser, serviceClient } from './helpers';

/**
 * RLS boundary tests: anonymous access is denied, customers see only their
 * own rows, staff see all, and write paths that must go through RPCs are
 * blocked at the table level.
 */
describe('row level security', () => {
  it('anon role cannot list tickets (deny-by-default)', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.from('tickets').select('id').limit(5);
    expect(data).toEqual([]);
    expect(error).toBeNull(); // RLS filters rows silently rather than erroring
  });

  it('customer sees only their own tickets', async () => {
    const maria = await asUser(MARIA);
    const { data: mariaTickets } = await maria.from('tickets').select('id, customer_id');
    expect(mariaTickets!.length).toBeGreaterThan(0);
    expect(mariaTickets!.every((t) => t.customer_id === mariaTickets![0]!.customer_id)).toBe(true);

    const devon = await asUser(DEVON);
    const devonTicketIds = new Set((await devon.from('tickets').select('id')).data!.map((t) => t.id));
    for (const ticket of mariaTickets!) {
      expect(devonTicketIds.has(ticket.id)).toBe(false);
    }
  });

  it("customer cannot read another customer's order", async () => {
    const maria = await asUser(MARIA);
    const { data: devonOrder } = await serviceClient
      .from('orders')
      .select('id')
      .eq('order_number', 'ORD-2001')
      .limit(1);
    const { data: visible } = await maria.from('orders').select('id').eq('id', devonOrder![0]!.id);
    expect(visible).toEqual([]);
  });

  it('agent sees all tickets', async () => {
    const agent = await asUser(AGENT);
    const { count } = await agent.from('tickets').select('id', { count: 'exact', head: true });
    const { count: total } = await serviceClient.from('tickets').select('id', { count: 'exact', head: true });
    expect(count).toBe(total);
  });

  it('customer cannot read audit logs or ingestion jobs', async () => {
    const maria = await asUser(MARIA);
    const { data: audit } = await maria.from('audit_logs').select('id').limit(5);
    expect(audit).toEqual([]);
    const { data: jobs } = await maria.from('ingestion_jobs').select('id').limit(5);
    expect(jobs).toEqual([]);
  });

  it('customer cannot insert into return_requests directly (RPC only)', async () => {
    const maria = await asUser(MARIA);
    const { data: ownOrder } = await maria.from('orders').select('id').eq('order_number', 'ORD-1001').limit(1);
    const userId = (await maria.auth.getUser()).data.user!.id;
    const { error } = await maria.from('return_requests').insert({
      order_id: ownOrder![0]!.id,
      customer_id: userId,
      reason: 'direct insert attempt',
      idempotency_key: 'direct-insert-attempt',
    });
    expect(error).not.toBeNull();
  });

  it('customer cannot modify orders via update (no UPDATE policy)', async () => {
    const maria = await asUser(MARIA);
    const { data: ownOrder } = await maria.from('orders').select('id').eq('order_number', 'ORD-1001').limit(1);
    const { error } = await maria.from('orders').update({ status: 'DELIVERED' }).eq('id', ownOrder![0]!.id);
    expect(error).not.toBeNull();
  });
});
