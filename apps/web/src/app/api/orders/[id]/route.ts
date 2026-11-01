import { ApiError, jsonOk, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ id: string }> };

/** Order detail: items, payment, and shipments with events (RLS-scoped). */
export const GET = withErrorHandler(async (_request: Request, context: RouteContext) => {
  await requireUser();
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found or not accessible.');

  const [itemsResult, paymentsResult, shipmentsResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, quantity, unit_price_cents, products (id, sku, name, category, returnable)')
      .eq('order_id', id),
    supabase.from('payments').select('*').eq('order_id', id).maybeSingle(),
    supabase.from('shipments').select('*').eq('order_id', id),
  ]);

  const shipments = shipmentsResult.data ?? [];
  const eventsByShipment = new Map<string, unknown[]>();
  await Promise.all(
    shipments.map(async (shipment) => {
      const { data: events } = await supabase
        .from('shipment_events')
        .select('*')
        .eq('shipment_id', shipment.id)
        .order('occurred_at', { ascending: true });
      eventsByShipment.set(shipment.id, events ?? []);
    })
  );

  return jsonOk({
    order,
    items: itemsResult.data ?? [],
    payment: paymentsResult.data ?? null,
    shipments: shipments.map((s) => ({ ...s, events: eventsByShipment.get(s.id) ?? [] })),
  });
});
