import { jsonOk, parsePagination, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Lists orders visible to the caller. Row scoping is enforced by RLS
 * (customers see only their own; staff see all) — this handler additionally
 * joins the summary fields the UI needs.
 */
export const GET = withErrorHandler(async (request: Request) => {
  await requireUser();
  const url = new URL(request.url);
  const { page, pageSize, from, to } = parsePagination(url);
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('orders')
    .select(
      'id, order_number, status, placed_at, delivered_at, total_cents, currency, payments (status), shipments (status, tracking_number)',
      { count: 'exact' }
    )
    .order('placed_at', { ascending: false })
    .range(from, to);

  const status = url.searchParams.get('status');
  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;
  if (error) {
    return jsonOk({ orders: [], page, pageSize, total: 0, error: error.message }, 500);
  }

  return jsonOk({ orders: data ?? [], page, pageSize, total: count ?? 0 });
});
