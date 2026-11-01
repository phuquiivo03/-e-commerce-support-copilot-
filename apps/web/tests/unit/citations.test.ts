import { describe, expect, it } from 'vitest';
import { normalizeForQuoteMatch, quoteAppearsInChunk, validateCitations } from '@/lib/copilot/citations';
import type { RetrievedChunk } from '@/lib/rag/retrieval';

const chunk: RetrievedChunk = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  documentTitle: 'Returns & Exchanges Policy',
  documentVersion: 2,
  category: 'RETURNS',
  region: 'US',
  productCategory: null,
  heading: 'Return Window',
  content: 'Most items can be returned within 30 days of the delivery date. Electronics can be returned within 14 days.',
  score: 0.02,
  ftsRank: 1,
  vectorRank: null,
};

const orderFacts = {
  orderId: 'order-1',
  orderNumber: 'ORD-1001',
  fields: { status: 'DELIVERED', 'payments.payment_status': 'PAID' },
};

function chunkCitation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'policy_chunk' as const,
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    documentTitle: 'Returns & Exchanges Policy',
    documentVersion: 2,
    heading: 'Return Window',
    quote: 'Most items can be returned within 30 days of the delivery date.',
    ...overrides,
  };
}

describe('citation validation', () => {
  it('accepts a citation with a verbatim quote from a retrieved chunk', () => {
    const { valid, dropped } = validateCitations([chunkCitation()], [chunk], null);
    expect(dropped).toBe(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ kind: 'policy_chunk', chunkId: 'chunk-1' });
  });

  it('accepts quotes with differing punctuation/whitespace/case', () => {
    expect(quoteAppearsInChunk('within 30 DAYS, of the delivery date!', chunk.content)).toBe(true);
  });

  it('drops citations for chunks that were never retrieved', () => {
    const { valid, dropped } = validateCitations(
      [chunkCitation({ chunkId: 'chunk-fabricated' })],
      [chunk],
      null
    );
    expect(dropped).toBe(1);
    expect(valid).toHaveLength(0);
  });

  it('drops citations whose quote does not appear in the chunk', () => {
    const { valid } = validateCitations(
      [chunkCitation({ quote: 'We fabricate a policy that does not exist anywhere.' })],
      [chunk],
      null
    );
    expect(valid).toHaveLength(0);
  });

  it('drops citations with a mismatched document title (invented titles)', () => {
    const { valid } = validateCitations([chunkCitation({ documentTitle: 'Imaginary Policy' })], [chunk], null);
    expect(valid).toHaveLength(0);
  });

  it('drops order citations for orders that were not fetched', () => {
    const { valid } = validateCitations(
      [{ kind: 'order_record', orderId: 'other-order', orderNumber: 'ORD-9999', fields: ['status'] }],
      [chunk],
      orderFacts
    );
    expect(valid).toHaveLength(0);
  });

  it('drops order citations claiming fields we never loaded', () => {
    const { valid } = validateCitations(
      [{ kind: 'order_record', orderId: 'order-1', orderNumber: 'ORD-1001', fields: ['refund_completed'] }],
      [chunk],
      orderFacts
    );
    expect(valid).toHaveLength(0);
  });

  it('keeps a valid order record citation', () => {
    const { valid } = validateCitations(
      [{ kind: 'order_record', orderId: 'order-1', orderNumber: 'ORD-1001', fields: ['status'] }],
      [chunk],
      orderFacts
    );
    expect(valid).toHaveLength(1);
  });

  it('normalizes unicode quotes and smart punctuation', () => {
    expect(normalizeForQuoteMatch('“Most items,” can be returned')).toBe(
      normalizeForQuoteMatch('"Most items" can be returned')
    );
  });
});
