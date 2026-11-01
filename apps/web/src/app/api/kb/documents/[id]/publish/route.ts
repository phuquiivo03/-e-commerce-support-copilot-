import { z } from 'zod';
import { ApiError, jsonOk, parseBody, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { correlationId } from '@/lib/api/http';

type RouteContext = { params: Promise<{ id: string }> };

const PublishSchema = z.object({
  effectiveFrom: z.string().date().default(new Date().toISOString().slice(0, 10)),
});

/**
 * Publishes a document version and supersedes the previously published one in
 * a single service-side flow:
 *   1. old published version (same title+region) → SUPERSEDED,
 *      effective_to = new effective_from - 1 day
 *   2. this document → PUBLISHED with the given effective_from
 *   3. an ingestion job is queued so chunks exist before the version is used
 *      as evidence (retrieval only sees applicable published versions).
 */
export const POST = withErrorHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser(['ADMIN']);
  const { id } = await context.params;
  const body = await parseBody(request, PublishSchema);
  const supabase = await createSupabaseServerClient();

  const { data: document } = await supabase
    .from('kb_documents')
    .select('id, title, region, version, status')
    .eq('id', id)
    .maybeSingle();
  if (!document) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

  const effectiveFrom = new Date(`${body.effectiveFrom}T00:00:00Z`);
  const previousDay = new Date(effectiveFrom);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const effectiveTo = previousDay.toISOString().slice(0, 10);

  const { data: currentPublished } = await supabase
    .from('kb_documents')
    .select('id')
    .eq('title', document.title)
    .eq('region', document.region)
    .eq('status', 'PUBLISHED')
    .neq('id', id);

  if (currentPublished && currentPublished.length > 0) {
    const { error: supersedeError } = await supabase
      .from('kb_documents')
      .update({ status: 'SUPERSEDED', effective_to: effectiveTo, superseded_by: id })
      .in('id', currentPublished.map((d) => d.id));
    if (supersedeError) throw new ApiError(500, 'DB_ERROR', supersedeError.message);
  }

  const { data: published, error: publishError } = await supabase
    .from('kb_documents')
    .update({ status: 'PUBLISHED', effective_from: body.effectiveFrom, effective_to: null })
    .eq('id', id)
    .select('id, title, version, status, effective_from')
    .single();
  if (publishError || !published) throw new ApiError(500, 'DB_ERROR', publishError?.message ?? 'Publish failed.');

  const service = createSupabaseServiceClient();
  const { error: jobError } = await service.from('ingestion_jobs').insert({ document_id: id, status: 'QUEUED' });
  if (jobError) {
    throw new ApiError(500, 'INGESTION_ENQUEUE_FAILED', 'Published, but ingestion could not be queued.');
  }

  await recordAudit({
    actorId: user.userId,
    actorRole: user.role,
    action: 'kb_document.published',
    entityType: 'kb_document',
    entityId: id,
    metadata: {
      version: published.version,
      effectiveFrom: published.effective_from,
      superseded: currentPublished?.map((d) => d.id) ?? [],
    },
    correlationId: correlationId(request),
  });

  return jsonOk({ document: published, supersededCount: currentPublished?.length ?? 0 });
});
