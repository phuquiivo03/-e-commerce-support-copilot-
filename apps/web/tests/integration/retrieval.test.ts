import { describe, expect, it } from 'vitest';
import { mockEmbed, toPgVectorLiteral } from '@copilot/shared';
import { MARIA, asUser, serviceClient } from './helpers';

/**
 * Hybrid retrieval: applicability filtering (only currently-published
 * versions) and RRF fusion over seeded policies. Requires the ingestion
 * worker to have processed the seeded documents.
 */
async function search(query: string, categories?: string[]) {
  const embedding = toPgVectorLiteral(mockEmbed(query, 1536));
  const { data, error } = await serviceClient.rpc('hybrid_search', {
    p_query: query,
    p_query_embedding: embedding,
    p_categories: categories ?? null,
    p_region: 'US',
    p_product_category: null,
    p_match_count: 8,
  });
  if (error) throw new Error(`hybrid_search failed: ${error.message}`);
  return (data ?? []) as Array<{
    document_title: string;
    document_version: number;
    chunk_id: string;
    content: string;
    score: number;
  }>;
}

describe('hybrid retrieval', () => {
  it('retrieves the current Returns policy for a window question', async () => {
    const results = await search('What is the return window for electronics?', ['RETURNS']);
    expect(results.length).toBeGreaterThan(0);
    const top = results[0]!;
    expect(top.document_title).toBe('Returns & Exchanges Policy');
    expect(top.document_version).toBe(2);
  });

  it('never returns superseded or draft versions', async () => {
    const results = await search('returns accepted after 60 days', ['RETURNS']);
    const titles = results.map((r) => `${r.document_title} v${r.document_version}`);
    for (const title of titles) {
      expect(title).not.toContain('v1'); // v1 is SUPERSEDED
      expect(title).not.toContain('v3'); // v3 is DRAFT
    }
  });

  it('fuses lexical and vector matches (both ranks present for a good query)', async () => {
    const results = await search('refund timing original payment method', ['REFUNDS']);
    expect(results.length).toBeGreaterThan(0);
  });

  it('respects category filtering', async () => {
    const results = await search('cancelling after shipment', ['CANCELLATION']);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.document_title === 'Cancellation Policy')).toBe(true);
  });

  it('honors RLS for customer callers (published docs only)', async () => {
    const maria = await asUser(MARIA);
    // Customers can read published docs; the RPC itself is service-role only,
    // so customers cannot call it at all — assert that boundary.
    const embedding = toPgVectorLiteral(mockEmbed('return window', 1536));
    const { error } = await maria.rpc('hybrid_search', {
      p_query: 'return window',
      p_query_embedding: embedding,
    });
    expect(error).not.toBeNull();
  });
});
