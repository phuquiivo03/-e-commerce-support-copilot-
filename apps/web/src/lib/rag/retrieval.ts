/**
 * Hybrid retrieval over the rag.hybrid_search Postgres function:
 * PostgreSQL full-text search + pgvector cosine similarity fused with
 * Reciprocal Rank Fusion (k=60), restricted to currently-published and
 * applicable document versions (enforced in SQL, not by the model).
 */
import type { KbDocumentCategory } from '@copilot/shared';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { getEmbeddingAdapter, toPgVectorLiteral } from '@/lib/rag/embeddings';
import { getEnv } from '@/lib/env';

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentVersion: number;
  category: string;
  region: string | null;
  productCategory: string | null;
  heading: string | null;
  content: string;
  score: number;
  ftsRank: number | null;
  vectorRank: number | null;
};

export type RetrievalFilters = {
  categories?: KbDocumentCategory[];
  region?: string | null;
  productCategory?: string | null;
  matchCount?: number;
};

export type RetrievalResult = {
  chunks: RetrievedChunk[];
  embeddingProvider: string;
  latencyMs: number;
};

export async function retrievePolicyEvidence(
  query: string,
  filters: RetrievalFilters = {}
): Promise<RetrievalResult> {
  const started = Date.now();
  const env = getEnv();
  const adapter = getEmbeddingAdapter();
  const supabase = createSupabaseServiceClient();

  const [embedding] = await adapter.embed([query]);
  if (!embedding) {
    throw new Error('Embedding adapter returned no vector for the query.');
  }

  const { data, error } = await supabase.rpc('hybrid_search', {
    p_query: query,
    p_query_embedding: toPgVectorLiteral(embedding),
    p_categories: filters.categories ?? null,
    p_region: filters.region ?? null,
    p_product_category: filters.productCategory ?? null,
    p_match_count: filters.matchCount ?? env.RETRIEVAL_MATCH_COUNT,
  });

  if (error) {
    throw new Error(`Hybrid search failed: ${error.message}`);
  }

  const chunks = (data ?? []).map(
    (row): RetrievedChunk => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      documentVersion: row.document_version,
      category: row.category,
      region: row.region,
      productCategory: row.product_category,
      heading: row.heading,
      content: row.content,
      score: row.score,
      ftsRank: row.fts_rank,
      vectorRank: row.vector_rank,
    })
  );

  return { chunks, embeddingProvider: adapter.name, latencyMs: Date.now() - started };
}
