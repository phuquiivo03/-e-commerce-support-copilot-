import { ApiError, jsonOk, parsePagination, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Ingestion job status feed for the KB admin UI (admin only). */
export const GET = withErrorHandler(async (request: Request) => {
  await requireUser(['ADMIN']);
  const url = new URL(request.url);
  const { page, pageSize, from, to } = parsePagination(url);
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('ingestion_jobs')
    .select(
      'id, status, attempts, max_attempts, error, created_at, started_at, finished_at, kb_documents ( id, title, version, status )',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  const status = url.searchParams.getAll('status');
  if (status.length) query = query.in('status', status);

  const { data, error, count } = await query;
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  return jsonOk({ jobs: data ?? [], page, pageSize, total: count ?? 0 });
});
