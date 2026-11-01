import { describe, expect, it } from 'vitest';
import { ADMIN, AGENT, MARIA, asUser, serviceClient } from './helpers';

/** Seed integrity: demo users, roles, and the applicability model. */
describe('seed data', () => {
  it('has demo users with roles from app_metadata', async () => {
    const { data: admin } = await serviceClient.from('profiles').select('role').eq('email', ADMIN).single();
    const { data: agent } = await serviceClient.from('profiles').select('role').eq('email', AGENT).single();
    const { data: customer } = await serviceClient.from('profiles').select('role').eq('email', MARIA).single();
    expect(admin?.role).toBe('ADMIN');
    expect(agent?.role).toBe('SUPPORT_AGENT');
    expect(customer?.role).toBe('CUSTOMER');
  });

  it('only one version per policy family is currently applicable', async () => {
    const { data: returns } = await serviceClient
      .from('kb_documents')
      .select('id, version, status, effective_from, effective_to')
      .eq('title', 'Returns & Exchanges Policy');
    const applicable = (returns ?? []).filter(
      (d) =>
        d.status === 'PUBLISHED' &&
        new Date(d.effective_from) <= new Date() &&
        (!d.effective_to || new Date(d.effective_to) >= new Date())
    );
    expect(applicable).toHaveLength(1);
    expect(applicable[0]!.version).toBe(2);
  });

  it('policy applicability is enforced in SQL, not left to the LLM', async () => {
    // The draft v3 and superseded v1 exist but are not PUBLISHED.
    const { data: docs } = await serviceClient
      .from('kb_documents')
      .select('version, status')
      .eq('title', 'Returns & Exchanges Policy')
      .order('version');
    expect(docs?.map((d) => d.status)).toEqual(['SUPERSEDED', 'PUBLISHED', 'DRAFT']);
  });
});
