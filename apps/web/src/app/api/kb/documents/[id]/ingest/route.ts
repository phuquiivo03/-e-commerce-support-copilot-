import { ApiError, jsonOk, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { correlationId } from '@/lib/api/http';

type RouteContext = { params: Promise<{ id: string }> };

/** Admin re-queues ingestion for a document (e.g. after fixing content). */
export const POST = withErrorHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser(['ADMIN']);
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();

  const { data: document } = await supabase
    .from('kb_documents')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

  const service = createSupabaseServiceClient();
  const { error } = await service.from('ingestion_jobs').insert({ document_id: id, status: 'QUEUED' });
  if (error) throw new ApiError(500, 'INGESTION_ENQUEUE_FAILED', error.message);

  await recordAudit({
    actorId: user.userId,
    actorRole: user.role,
    action: 'kb_document.ingestion_queued',
    entityType: 'kb_document',
    entityId: id,
    correlationId: correlationId(request),
  });

  return jsonOk({ queued: true }, 202);
});
