import { z } from 'zod';
import { ApiError, jsonOk, parseBody, parsePagination, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { correlationId } from '@/lib/api/http';

/** Knowledge-base document list (staff). */
export const GET = withErrorHandler(async (request: Request) => {
  await requireUser(['ADMIN', 'SUPPORT_AGENT']);
  const url = new URL(request.url);
  const { page, pageSize, from, to } = parsePagination(url);
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('kb_documents')
    .select('id, title, category, version, status, effective_from, effective_to, region, product_category, superseded_by, created_at, updated_at', { count: 'exact' })
    .order('title')
    .order('version', { ascending: false })
    .range(from, to);

  const status = url.searchParams.getAll('status');
  if (status.length) query = query.in('status', status);
  const category = url.searchParams.get('category');
  if (category) query = query.eq('category', category);

  const { data, error, count } = await query;
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  return jsonOk({ documents: data ?? [], page, pageSize, total: count ?? 0 });
});

const CreateDocumentSchema = z.object({
  title: z.string().min(3).max(200),
  category: z.enum(['SHIPPING', 'CANCELLATION', 'RETURNS', 'REFUNDS', 'WARRANTY']),
  content: z.string().min(10),
  region: z.string().min(2).max(8).default('US'),
  productCategory: z.string().max(80).nullish(),
  effectiveFrom: z.string().date().default(new Date().toISOString().slice(0, 10)),
});

/** Admin creates a document (starts as DRAFT). */
export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser(['ADMIN']);
  const body = await parseBody(request, CreateDocumentSchema);
  const supabase = await createSupabaseServerClient();

  // A new document starts at the next free version for (title, region).
  const { data: existing } = await supabase
    .from('kb_documents')
    .select('version')
    .eq('title', body.title)
    .eq('region', body.region)
    .order('version', { ascending: false })
    .limit(1);

  const { data: document, error } = await supabase
    .from('kb_documents')
    .insert({
      title: body.title,
      category: body.category,
      version: (existing?.[0]?.version ?? 0) + 1,
      status: 'DRAFT',
      effective_from: body.effectiveFrom,
      region: body.region,
      product_category: body.productCategory ?? null,
      content: body.content,
      created_by: user.userId,
    })
    .select('id, title, version, status')
    .single();
  if (error || !document) throw new ApiError(422, 'DB_ERROR', error?.message ?? 'Failed to create document.');

  await recordAudit({
    actorId: user.userId,
    actorRole: user.role,
    action: 'kb_document.created',
    entityType: 'kb_document',
    entityId: document.id,
    metadata: { title: document.title, version: document.version },
    correlationId: correlationId(request),
  });

  return jsonOk({ document }, 201);
});
