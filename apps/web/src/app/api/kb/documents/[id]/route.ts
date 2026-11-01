import { z } from 'zod';
import { ApiError, jsonOk, parseBody, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { correlationId } from '@/lib/api/http';

type RouteContext = { params: Promise<{ id: string }> };

/** Document detail including indexed chunks (admin + agents). */
export const GET = withErrorHandler(async (_request: Request, context: RouteContext) => {
  await requireUser(['ADMIN', 'SUPPORT_AGENT']);
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();

  const { data: document, error } = await supabase
    .from('kb_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

  const { data: chunks } = await supabase
    .from('kb_chunks')
    .select('id, chunk_index, heading, content, embedding_model, content_hash, created_at')
    .eq('document_id', id)
    .order('chunk_index');

  const { data: jobs } = await supabase
    .from('ingestion_jobs')
    .select('id, status, attempts, max_attempts, error, created_at, finished_at')
    .eq('document_id', id)
    .order('created_at', { ascending: false })
    .limit(5);

  return jsonOk({ document, chunks: chunks ?? [], jobs: jobs ?? [] });
});

const PatchDocumentSchema = z.object({
  content: z.string().min(10).optional(),
  category: z.enum(['SHIPPING', 'CANCELLATION', 'RETURNS', 'REFUNDS', 'WARRANTY']).optional(),
  region: z.string().min(2).max(8).optional(),
  productCategory: z.string().max(80).nullish(),
  status: z.enum(['DRAFT', 'ARCHIVED']).optional(),
  effectiveFrom: z.string().date().optional(),
});

/**
 * Admin edits. Content changes re-queue ingestion so the index never goes
 * stale; a document that fails ingestion simply keeps its previous chunks
 * (atomic replacement) and the job shows the error.
 */
export const PATCH = withErrorHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser(['ADMIN']);
  const { id } = await context.params;
  const body = await parseBody(request, PatchDocumentSchema);
  const supabase = await createSupabaseServerClient();

  const { data: document, error } = await supabase
    .from('kb_documents')
    .update({
      ...(body.content ? { content: body.content } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(body.region ? { region: body.region } : {}),
      ...(body.productCategory !== undefined ? { product_category: body.productCategory ?? null } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.effectiveFrom ? { effective_from: body.effectiveFrom } : {}),
    })
    .eq('id', id)
    .select('id, title, version, status')
    .single();
  if (error || !document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', error?.message ?? 'Document not found.');

  if (body.content) {
    await enqueueIngestion(id);
  }

  await recordAudit({
    actorId: user.userId,
    actorRole: user.role,
    action: 'kb_document.updated',
    entityType: 'kb_document',
    entityId: id,
    metadata: { fields: Object.keys(body) },
    correlationId: correlationId(request),
  });

  return jsonOk({ document });
});

async function enqueueIngestion(documentId: string): Promise<void> {
  const { createSupabaseServiceClient } = await import('@/lib/supabase/server');
  const service = createSupabaseServiceClient();
  const { error } = await service.from('ingestion_jobs').insert({ document_id: documentId, status: 'QUEUED' });
  if (error) {
    console.error('[kb] failed to enqueue ingestion job', error.message);
    throw new ApiError(500, 'INGESTION_ENQUEUE_FAILED', 'Document saved but ingestion could not be queued.');
  }
}
