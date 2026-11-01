import { z } from 'zod';
import { ApiError, jsonOk, parseBody, parsePagination, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const CreateReturnSchema = z.object({
  orderId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(120),
  reason: z.string().min(4).max(1000),
  itemIds: z.array(z.string().uuid()).default([]),
  eligibility: z
    .object({
      status: z.enum(['ELIGIBLE', 'NOT_ELIGIBLE', 'INDETERMINATE']),
      reasons: z.array(z.string()).default([]),
    })
    .nullish(),
});

/** Lists return requests visible to the caller (RLS-scoped). */
export const GET = withErrorHandler(async (request: Request) => {
  await requireUser();
  const url = new URL(request.url);
  const { page, pageSize, from, to } = parsePagination(url);
  const supabase = await createSupabaseServerClient();

  const { data, error, count } = await supabase
    .from('return_requests')
    .select('*, orders (order_number, status)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  return jsonOk({ returnRequests: data ?? [], page, pageSize, total: count ?? 0 });
});

/**
 * Creates a return request through the app.create_return_request RPC,
 * which (in one transaction, with the caller's identity) enforces ownership,
 * active-return uniqueness, and idempotency via the
 * unique(order_id, idempotency_key) constraint, then writes an audit row.
 * The caller may supply the eligibility result for the audit trail; the RPC
 * never trusts it as authorization.
 */
export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const body = await parseBody(request, CreateReturnSchema);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc('create_return_request', {
    p_order_id: body.orderId,
    p_idempotency_key: body.idempotencyKey,
    p_reason: body.reason,
    p_item_ids: body.itemIds,
    p_evidence: body.eligibility ?? null,
  });

  if (error) {
    const message = error.message;
    if (message.includes('FORBIDDEN')) throw new ApiError(403, 'FORBIDDEN', 'You do not own this order.');
    if (message.includes('ORDER_NOT_FOUND')) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found or not accessible.');
    if (message.includes('RETURN_ALREADY_ACTIVE')) throw new ApiError(409, 'RETURN_ALREADY_ACTIVE', 'This order already has an active return request.');
    if (message.includes('ORDER_CANCELLED')) throw new ApiError(409, 'ORDER_CANCELLED', 'Cancelled orders cannot be returned.');
    if (message.includes('UNAUTHENTICATED')) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
    throw new ApiError(500, 'DB_ERROR', message);
  }

  const result = data as { created: boolean; return_request: unknown };
  return jsonOk(
    { returnRequest: result.return_request, idempotentReplay: !result.created },
    result.created ? 201 : 200
  );
});
