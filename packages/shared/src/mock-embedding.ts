/**
 * Deterministic hashed bag-of-words embedding (unigrams + bigrams),
 * L2-normalized. Shared between the web app's mock embedding adapter and the
 * evaluation suite so both compute identical vectors.
 *
 * IMPORTANT: this is NOT a semantic embedding model — vectors encode lexical
 * token overlap and are intended for local development and tests only.
 */
import { createHash } from 'node:crypto';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has',
  'have', 'i', 'if', 'in', 'is', 'it', 'its', 'my', 'of', 'on', 'or', 'our',
  'so', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we',
  'were', 'will', 'with', 'you', 'your',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function mockEmbed(text: string, dims: number): number[] {
  const vector = new Float64Array(dims);
  const tokens = tokenize(text);

  const addToken = (token: string, weight: number) => {
    const hash = createHash('sha256').update(token).digest();
    const index = hash.readUInt32BE(0) % dims;
    // A second hash decides the sign to reduce collision damage.
    const sign = (hash.readUInt32BE(4) & 1) === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign * weight;
  };

  for (let i = 0; i < tokens.length; i++) {
    addToken(tokens[i]!, 1);
    if (i + 1 < tokens.length) {
      addToken(`${tokens[i]}_${tokens[i + 1]}`, 0.6);
    }
  }

  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vector[i]! * vector[i]!;
  norm = Math.sqrt(norm) || 1;

  return Array.from(vector, (v) => v / norm);
}

/** pgvector text literal used by the hybrid_search RPC. */
export function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => v.toFixed(7)).join(',')}]`;
}
