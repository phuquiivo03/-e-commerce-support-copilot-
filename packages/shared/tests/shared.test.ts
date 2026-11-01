import { describe, expect, it } from 'vitest';
import { CopilotResponseSchema, CitationSchema, mockEmbed, toPgVectorLiteral } from '@copilot/shared';

describe('mock embeddings', () => {
  it('are deterministic for the same input', () => {
    const a = mockEmbed('return window electronics', 1536);
    const b = mockEmbed('return window electronics', 1536);
    expect(a).toEqual(b);
  });

  it('are L2-normalized', () => {
    const v = mockEmbed('some policy text about refunds', 1536);
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('overlap more for similar texts than dissimilar ones', () => {
    const dot = (a: number[], b: number[]) => a.reduce((acc, x, i) => acc + x * b[i]!, 0);
    const base = mockEmbed('most items can be returned within 30 days of the delivery date', 1536);
    const similar = mockEmbed('items can be returned within 30 days of delivery', 1536);
    const dissimilar = mockEmbed('warranty covers manufacturing defects for twelve months', 1536);
    expect(dot(base, similar)).toBeGreaterThan(dot(base, dissimilar));
  });

  it('serializes to a pgvector literal', () => {
    const literal = toPgVectorLiteral([0.1, -0.2]);
    expect(literal).toBe('[0.1000000,-0.2000000]');
  });
});

describe('copilot response schema', () => {
  it('validates a well-formed response', () => {
    const parsed = CopilotResponseSchema.safeParse({
      behavior: 'ANSWER',
      message: 'Hello',
      citations: [],
      missingInformation: [],
      suggestedNextActions: [],
      requiresHumanReview: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown behavior', () => {
    const parsed = CopilotResponseSchema.safeParse({
      behavior: 'MAYBE',
      message: 'Hello',
      citations: [],
      missingInformation: [],
      suggestedNextActions: [],
      requiresHumanReview: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects fabricated citation kinds', () => {
    const parsed = CitationSchema.safeParse({ kind: 'made_up', chunkId: 'x' });
    expect(parsed.success).toBe(false);
  });
});
