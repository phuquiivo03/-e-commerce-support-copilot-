import { z } from 'zod';
import { ApiError, jsonOk, parseBody, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { correlationId } from '@/lib/api/http';

type RouteContext = { params: Promise<{ id: string }> };

/** Ticket detail: conversation, customer summary, linked order snapshot. */
export const GET = withErrorHandler(async (_request: Request, context: RouteContext) => {
  await requireUser();
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      '*, customers ( shipping_address, phone, profiles ( full_name, email ) ), orders ( id, order_number, status, placed_at, total_cents, currency, delivered_at )'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found or not accessible.');

  const [messagesResult, paymentResult, shipmentsResult, runsResult] = await Promise.all([
    supabase
      .from('ticket_messages')
      .select('id, author_type, author_id, body, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
    ticket.order_id
      ? supabase.from('payments').select('status, amount_cents, last4, method').eq('order_id', ticket.order_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ticket.order_id
      ? supabase.from('shipments').select('id, tracking_number, status, estimated_delivery, delivered_at, carrier').eq('order_id', ticket.order_id)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('copilot_runs')
      .select('id, outcome, citations, missing_information, suggested_next_actions, requires_human_review, provider, latency_ms, created_at, trace')
      .eq('ticket_id', id)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const shipments = shipmentsResult.data ?? [];
  const events = ticket.order_id && shipments.length
    ? (await supabase
        .from('shipment_events')
        .select('id, shipment_id, status, description, occurred_at')
        .in('shipment_id', shipments.map((s) => s.id))
        .order('occurred_at', { ascending: true })).data ?? []
    : [];

  return jsonOk({
    ticket,
    messages: messagesResult.data ?? [],
    payment: paymentResult.data ?? null,
    shipments,
    shipmentEvents: events,
    copilotRuns: runsResult.data ?? [],
  });
});

const PatchTicketSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: z.enum(['ORDER_STATUS', 'RETURNS', 'REFUNDS', 'SHIPPING', 'WARRANTY', 'OTHER']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

/** Staff-only updates: status transitions, priority, assignment. */
export const PATCH = withErrorHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser(['ADMIN', 'SUPPORT_AGENT']);
  const { id } = await context.params;
  const body = await parseBody(request, PatchTicketSchema);
  const supabase = await createSupabaseServerClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update({
      ...(body.status ? { status: body.status } : {}),
      ...(body.priority ? { priority: body.priority } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(body.assignedTo !== undefined ? { assigned_to: body.assignedTo } : {}),
    })
    .eq('id', id)
    .select('id, ticket_number, status')
    .single();
  if (error || !ticket) throw new ApiError(404, 'TICKET_NOT_FOUND', error?.message ?? 'Ticket not found or not accessible.');

  await recordAudit({
    actorId: user.userId,
    actorRole: user.role,
    action: 'ticket.updated',
    entityType: 'ticket',
    entityId: ticket.id,
    metadata: { ...body },
    correlationId: correlationId(request),
  });

  return jsonOk({ ticket });
});

/** Escalation is an explicit staff action; audit-logged. */
export const PUT = withErrorHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser(['ADMIN', 'SUPPORT_AGENT']);
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update({ status: 'ESCALATED', assigned_to: user.userId })
    .eq('id', id)
    .select('id, ticket_number, status')
    .single();
  if (error || !ticket) throw new ApiError(404, 'TICKET_NOT_FOUND', error?.message ?? 'Ticket not found or not accessible.');

  await recordAudit({
    actorId: user.userId,
    actorRole: user.role,
    action: 'ticket.escalated',
    entityType: 'ticket',
    entityId: ticket.id,
    correlationId: correlationId(request),
  });

  return jsonOk({ ticket });
});
