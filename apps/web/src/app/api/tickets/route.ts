import { z } from 'zod';
import { ApiError, jsonOk, parseBody, parsePagination, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';

const CreateTicketSchema = z.object({
  subject: z.string().min(4).max(200),
  body: z.string().min(4).max(8000),
  category: z.enum(['ORDER_STATUS', 'RETURNS', 'REFUNDS', 'SHIPPING', 'WARRANTY', 'OTHER']).default('OTHER'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  orderNumber: z.string().regex(/^ORD-\d{3,}$/).nullish(),
});

/** Ticket inbox: staff see configured scope; customers see their own (RLS). */
export const GET = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const { page, pageSize, from, to } = parsePagination(url);
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('tickets')
    .select(
      'id, ticket_number, subject, category, priority, status, assigned_to, created_at, updated_at, customer_id, orders (order_number, status), customers ( profiles ( full_name ) )',
      { count: 'exact' }
    )
    .order('updated_at', { ascending: false })
    .range(from, to);

  const status = url.searchParams.getAll('status');
  if (status.length) query = query.in('status', status);
  const category = url.searchParams.get('category');
  if (category) query = query.eq('category', category);
  const priority = url.searchParams.getAll('priority');
  if (priority.length) query = query.in('priority', priority);
  const q = url.searchParams.get('q');
  if (q) query = query.ilike('subject', `%${q}%`);

  // Configurable support permission: agents see all tickets by default, or
  // only theirs (plus unassigned) when SUPPORT_AGENT_SCOPE=assigned.
  const env = getEnv();
  if (user.role === 'SUPPORT_AGENT' && env.SUPPORT_AGENT_SCOPE === 'assigned') {
    query = query.or(`assigned_to.is.null,assigned_to.eq.${user.userId}`);
  }

  const { data, error, count } = await query;
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  return jsonOk({ tickets: data ?? [], page, pageSize, total: count ?? 0 });
});

/** Customers can open a ticket; staff assignment/status handled via PATCH. */
export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser(['CUSTOMER']);
  const body = await parseBody(request, CreateTicketSchema);
  const supabase = await createSupabaseServerClient();

  let orderId: string | null = null;
  if (body.orderNumber) {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('order_number', body.orderNumber)
      .maybeSingle();
    // Silently ignoring another customer's order number is intentional: the
    // ticket is still created, just without an order link.
    orderId = order?.id ?? null;
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      customer_id: user.userId,
      subject: body.subject,
      category: body.category,
      priority: body.priority,
      order_id: orderId,
      status: 'OPEN',
      ticket_number: `TKT-${Date.now().toString(36).toUpperCase()}`,
    })
    .select('id, ticket_number')
    .single();
  if (error || !ticket) throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Failed to create ticket.');

  const { error: messageError } = await supabase.from('ticket_messages').insert({
    ticket_id: ticket.id,
    author_id: user.userId,
    author_type: 'CUSTOMER',
    body: body.body,
  });
  if (messageError) throw new ApiError(500, 'DB_ERROR', messageError.message);

  return jsonOk({ ticket }, 201);
});
