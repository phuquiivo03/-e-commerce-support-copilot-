import { ApiError, jsonOk, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { computeReturnEligibility, type EligibilityOrderContext } from '@/lib/copilot/rules/returns';
import type { ReturnEligibilityResult } from '@copilot/shared';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Deterministic return-eligibility check for an order. The order must be
 * visible to the caller under RLS (owners and staff), so authorization is
 * enforced by the database even though the computation itself is pure.
 */
export const GET = withErrorHandler(async (_request: Request, context: RouteContext) => {
  await requireUser();
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, order_number, status, delivered_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found or not accessible.');

  const [itemsResult, activeReturnsResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, products (name, category, returnable)')
      .eq('order_id', order.id),
    supabase
      .from('return_requests')
      .select('id')
      .eq('order_id', order.id)
      .in('status', ['PENDING_REVIEW', 'APPROVED'])
      .limit(1),
  ]);

  const eligibilityContext: EligibilityOrderContext = {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    deliveredAt: order.delivered_at,
    items: (itemsResult.data ?? []).map((item) => {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      return {
        itemId: item.id,
        productName: product?.name ?? 'Unknown product',
        productCategory: product?.category ?? 'UNKNOWN',
        productReturnable: product?.returnable ?? true,
      };
    }),
    activeReturnRequest: (activeReturnsResult.data ?? []).length > 0,
  };

  const result: ReturnEligibilityResult = computeReturnEligibility(eligibilityContext);
  return jsonOk({ eligibility: result });
});
