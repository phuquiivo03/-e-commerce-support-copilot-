import { jsonOk, parsePagination, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Audit log feed (admin only, read-only). */
export const GET = withErrorHandler(async (request: Request) => {
  await requireUser(['ADMIN']);
  const url = new URL(request.url);
  const { page, pageSize, from, to } = parsePagination(url);
  const supabase = await createSupabaseServerClient();

  const { data, error, count } = await supabase
    .from('audit_logs')
    .select('id, actor_id, actor_role, action, entity_type, entity_id, metadata, correlation_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return jsonOk({ logs: [], page, pageSize, total: 0 }, 500);
  return jsonOk({ logs: data ?? [], page, pageSize, total: count ?? 0 });
});
