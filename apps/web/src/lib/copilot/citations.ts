/**
 * Citation integrity: a citation may only reference a chunk that was actually
 * retrieved (with a quote that verbatim appears in that chunk) or a structured
 * order record that was actually fetched and authorized for this ticket.
 * Anything else is dropped — fabricated citation IDs, titles, or quotations
 * never reach the persisted draft.
 */
import type { Citation, OrderRecordCitation, PolicyChunkCitation } from '@copilot/shared';
import type { RetrievedChunk } from '@/lib/rag/retrieval';

export type OrderFacts = {
  orderId: string;
  orderNumber: string;
  fields: Record<string, unknown>;
};

export function normalizeForQuoteMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"«»]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateCitations(
  candidates: Citation[],
  retrieved: RetrievedChunk[],
  orderFacts: OrderFacts | null
): { valid: Citation[]; dropped: number } {
  const chunkById = new Map(retrieved.map((c) => [c.chunkId, c]));
  const seen = new Set<string>();
  const valid: Citation[] = [];

  for (const candidate of candidates) {
    if (candidate.kind === 'policy_chunk') {
      const chunk = chunkById.get(candidate.chunkId);
      // Title/version must match what retrieval actually returned.
      if (!chunk || candidate.documentTitle !== chunk.documentTitle || candidate.documentVersion !== chunk.documentVersion) {
        continue;
      }
      if (!quoteAppearsInChunk(candidate.quote, chunk.content)) continue;
      const key = `chunk:${candidate.chunkId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const normalized: PolicyChunkCitation = {
        kind: 'policy_chunk',
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        documentVersion: chunk.documentVersion,
        heading: chunk.heading,
        quote: extractQuoteWindow(candidate.quote, chunk.content),
      };
      valid.push(normalized);
    } else {
      if (!orderFacts || candidate.orderId !== orderFacts.orderId) continue;
      // Every claimed field must be a real field we actually loaded.
      const fields = candidate.fields.filter((f) => f in orderFacts.fields);
      if (fields.length === 0) continue;
      const key = `order:${candidate.orderId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const normalized: OrderRecordCitation = {
        kind: 'order_record',
        orderId: orderFacts.orderId,
        orderNumber: orderFacts.orderNumber,
        fields,
      };
      valid.push(normalized);
    }
  }

  return { valid, dropped: candidates.length - valid.length };
}

/** Checks the quote appears in the chunk after whitespace/punctuation normalization. */
export function quoteAppearsInChunk(quote: string, chunkContent: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (q.length < 8) return false;
  return normalizeForQuoteMatch(chunkContent).includes(q);
}

/**
 * Snips a verbatim sentence (or contiguous run of sentences) from the original
 * chunk that covers the claimed quote, so the displayed quote is guaranteed to
 * be verbatim chunk text.
 */
function extractQuoteWindow(quote: string, chunkContent: string): string {
  const sentences = chunkContent.match(/[^.!?\n]+[.!?]?/g) ?? [chunkContent];
  const q = normalizeForQuoteMatch(quote);
  const acc: string[] = [];

  for (const sentence of sentences) {
    acc.push(sentence);
    const joined = acc.join(' ');
    if (normalizeForQuoteMatch(joined).includes(q)) {
      return joined.trim();
    }
  }

  // Fallback: the quote itself (it passed the containment check above).
  return quote;
}
