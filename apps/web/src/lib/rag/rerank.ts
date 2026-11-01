/**
 * Optional reranking, behind a configurable interface. The default
 * implementation is a pass-through: enable a real reranker by providing
 * RERANK_BASE_URL/RERANK_MODEL (Jina/Cohere-compatible /rerank endpoint) via
 * environment variables. Reranking reorders retrieved chunks but can never
 * introduce chunks that retrieval did not return.
 */
import { getEnv } from '@/lib/env';
import type { RetrievedChunk } from '@/lib/rag/retrieval';

export interface RerankAdapter {
  readonly name: string;
  rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]>;
}

class PassThroughReranker implements RerankAdapter {
  readonly name = 'none';
  async rerank(_query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    return chunks;
  }
}

class HttpReranker implements RerankAdapter {
  readonly name = 'http';
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly model: string
  ) {}

  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return chunks;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/rerank`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: chunks.map((c) => c.content),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        // Reranking is best-effort: on provider failure keep retrieval order.
        console.error(`[rerank] provider returned ${response.status}; keeping retrieval order`);
        return chunks;
      }
      const payload = (await response.json()) as {
        results?: Array<{ index: number; relevance_score?: number }>;
      };
      if (!payload.results) return chunks;
      const reordered = payload.results
        .flatMap((r) => {
          const chunk = chunks[r.index];
          return chunk ? [{ chunk, score: r.relevance_score ?? 0 }] : [];
        })
        .sort((a, b) => b.score - a.score)
        .map((entry, i) => ({ ...entry.chunk, score: entry.score, rrfScore: entry.chunk.score, rank: i }));
      return reordered.map(({ rrfScore: _rrf, rank: _rank, ...chunk }) => chunk);
    } catch (error) {
      console.error('[rerank] failed; keeping retrieval order', error);
      return chunks;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getRerankAdapter(): RerankAdapter {
  const env = getEnv();
  // Optional RERANK_* vars (read lazily so they stay documented but optional).
  const baseUrl = process.env.RERANK_BASE_URL;
  const model = process.env.RERANK_MODEL;
  if (baseUrl && model) {
    return new HttpReranker(baseUrl, process.env.RERANK_API_KEY, model);
  }
  return new PassThroughReranker();
}
