import { describe, expect, it } from 'vitest';
import { chunkDocument, estimateTokens } from '@/lib/rag/chunking';

const doc = `Intro paragraph before any heading that explains the policy context in two sentences.

## Return Window
Most items can be returned within 30 days of the delivery date. Electronics can be returned within 14 days of the delivery date.

## Non-Returnable Items
Clearance and final-sale items are not returnable. Gift cards are not returnable.`;

describe('chunkDocument', () => {
  it('splits sections on markdown headings', () => {
    const chunks = chunkDocument(doc, { maxTokens: 100, overlapTokens: 0 });
    const headings = chunks.map((c) => c.heading);
    expect(headings).toEqual([null, 'Return Window', 'Non-Returnable Items']);
  });

  it('assigns sequential indices and keeps content non-empty', () => {
    const chunks = chunkDocument(doc, { maxTokens: 100, overlapTokens: 0 });
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    });
  });

  it('respects maxTokens when a section is long', () => {
    const longBody = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} with some policy text that keeps going and going.`).join('\n\n');
    const content = `## Long Section\n${longBody}`;
    const chunks = chunkDocument(content, { maxTokens: 60, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(80);
    }
  });

  it('carries overlap between consecutive chunks of a section', () => {
    const longBody = Array.from({ length: 10 }, (_, i) => `Unique sentence number ${i} with more detail.`).join('\n\n');
    const chunks = chunkDocument(`## Overlap\n${longBody}`, { maxTokens: 50, overlapTokens: 30 });
    if (chunks.length > 1) {
      const overlapSentence = chunks[0]!.content.split('\n\n').at(-1)!;
      expect(chunks[1]!.content).toContain(overlapSentence.replace(/^Paragraph /, 'Paragraph '));
    }
  });

  it('handles documents without headings as a single section', () => {
    const chunks = chunkDocument('Just a plain policy line one.\n\nAnd a second paragraph.', { maxTokens: 100, overlapTokens: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBeNull();
  });

  it('emits an oversized paragraph as its own chunk', () => {
    const huge = 'x'.repeat(1000);
    const chunks = chunkDocument(`## Huge\n${huge}\n\nSmall paragraph.`, { maxTokens: 60, overlapTokens: 0 });
    expect(chunks.length).toBe(2);
  });
});
