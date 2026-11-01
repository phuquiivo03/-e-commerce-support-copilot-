/**
 * Background ingestion worker.
 *
 * Queue design: a Postgres-backed job queue on `ingestion_jobs` claimed with
 * FOR UPDATE SKIP LOCKED (same concurrency semantics as a Redis/BullMQ
 * worker, without requiring Redis — Supabase has no Redis). Retries with a
 * bounded attempt count; a failed job never leaves a document in a partially
 * re-indexed state because chunk replacement happens inside one transaction.
 */
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { chunkDocument, DEFAULT_CHUNKING } from '@/lib/rag/chunking';
import { getEmbeddingAdapter } from '@/lib/rag/embeddings';
import { getEnv } from '@/lib/env';

export type IngestionJobRow = {
  id: string;
  document_id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  max_attempts: number;
  error: string | null;
};

export function getWorkerDbUrl(): string {
  return process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Claims the oldest QUEUED job (skipping locked ones). Returns null when the queue is empty. */
export async function claimJob(sql: postgres.Sql): Promise<IngestionJobRow | null> {
  const rows = await sql<IngestionJobRow[]>`
    update ingestion_jobs
    set status = 'RUNNING', started_at = now(), attempts = attempts + 1, updated_at = now(), error = null
    where id = (
      select id from ingestion_jobs
      where status = 'QUEUED'
      order by created_at
      for update skip locked
      limit 1
    )
    returning id, document_id, status, attempts, max_attempts, error
  `;
  return rows[0] ?? null;
}

export async function releaseJob(sql: postgres.Sql, job: IngestionJobRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const retry = job.attempts < job.max_attempts;
  await sql`
    update ingestion_jobs
    set status = ${retry ? 'QUEUED' : 'FAILED'},
        error = ${message.slice(0, 2000)},
        finished_at = ${retry ? null : sql`now()`},
        updated_at = now()
    where id = ${job.id}
  `;
}

export async function completeJob(sql: postgres.Sql, jobId: string): Promise<void> {
  await sql`
    update ingestion_jobs
    set status = 'SUCCEEDED', error = null, finished_at = now(), updated_at = now()
    where id = ${jobId}
  `;
}

/**
 * Processes one job: chunk → embed → atomically replace the document's
 * chunks. Returns true when a job was processed.
 */
export async function processNextJob(sql: postgres.Sql): Promise<boolean> {
  const job = await claimJob(sql);
  if (!job) return false;

  try {
    const documents = await sql<{ id: string; title: string; content: string; version: number; status: string }[]>`
      select id, title, content, version, status::text as status
      from kb_documents
      where id = ${job.document_id}
    `;
    const document = documents[0];
    if (!document) throw new Error('Document no longer exists.');

    if (document.status !== 'PUBLISHED') {
      throw new Error(`DOCUMENT_NOT_PUBLISHED: only published documents are ingested (status=${document.status}).`);
    }

    const env = getEnv();
    const chunks = chunkDocument(document.content, {
      maxTokens: env.INGESTION_CHUNK_TOKENS,
      overlapTokens: env.INGESTION_CHUNK_OVERLAP_TOKENS,
    });
    if (chunks.length === 0) throw new Error('Document produced no chunks (empty content).');

    const adapter = getEmbeddingAdapter();
    const vectors = await adapter.embed(chunks.map((c) => `${document.title}\n${c.heading ?? ''}\n${c.content}`));

    await sql.begin(async (tx) => {
      await tx`delete from kb_chunks where document_id = ${document.id}`;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        await tx`
          insert into kb_chunks (document_id, document_version, chunk_index, heading, content, embedding, embedding_model, content_hash)
          values (${document.id}, ${document.version}, ${chunk.index}, ${chunk.heading}, ${chunk.content},
                  ${toVectorLiteral(vectors[i]!)}, ${adapter.model}, ${contentHash(chunk.content)})
        `;
      }
    });

    await completeJob(sql, job.id);
    console.log(`[ingestion] document ${document.title} (v${document.version}): ${chunks.length} chunks embedded with ${adapter.name}/${adapter.model}`);
    return true;
  } catch (error) {
    console.error(`[ingestion] job ${job.id} failed (attempt ${job.attempts}/${job.max_attempts})`, error);
    await releaseJob(sql, job, error);
    return true;
  }
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => v.toFixed(7)).join(',')}]`;
}

/** Chunking options used by the API layer when explaining ingestion config. */
export function currentChunkingOptions() {
  return DEFAULT_CHUNKING;
}
