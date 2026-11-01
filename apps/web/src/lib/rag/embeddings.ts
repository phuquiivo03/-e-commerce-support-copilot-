/**
 * Embedding provider adapters.
 *
 * - `openai-compatible`: POST {baseUrl}/embeddings with an API key. Works with
 *   OpenAI and any compatible gateway configured via environment variables.
 * - `mock`: the deterministic hashed bag-of-words vector from
 *   @copilot/shared (identical to what the evaluation suite uses), intended
 *   for local development and the test suite ONLY. It is NOT a semantic
 *   embedding model: scores reflect lexical token overlap and must never be
 *   presented as real semantic-search quality.
 */
import { mockEmbed } from '@copilot/shared';
import { getEnv, providerConfigured } from '@/lib/env';

export interface EmbeddingAdapter {
  readonly name: string;
  readonly model: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function getEmbeddingAdapter(): EmbeddingAdapter {
  const env = getEnv();
  if (env.EMBEDDING_PROVIDER === 'openai-compatible' && providerConfigured('embedding')) {
    return new OpenAICompatibleEmbeddingAdapter(
      env.EMBEDDING_BASE_URL!,
      env.EMBEDDING_API_KEY!,
      env.EMBEDDING_MODEL,
      env.EMBEDDING_DIMS
    );
  }
  return new MockEmbeddingAdapter(env.EMBEDDING_DIMS, env.EMBEDDING_MODEL);
}

export class OpenAICompatibleEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'openai-compatible';
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
    readonly dims: number
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          dimensions: this.dims <= 3072 ? this.dims : undefined,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embedding provider returned ${response.status}: ${body.slice(0, 200)}`);
      }
      const payload = (await response.json()) as { data?: Array<{ embedding: number[]; index: number }> };
      const data = payload.data;
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new Error('Embedding provider returned an unexpected payload shape.');
      }
      return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MockEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'mock';
  constructor(readonly dims: number, readonly model: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => mockEmbed(t, this.dims));
  }
}
