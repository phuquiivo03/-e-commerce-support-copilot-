import { z } from 'zod';
import { ApiError, jsonOk, parseBody, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (_request: Request, context: RouteContext) => {
  await requireUser();
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ticket_messages')
    .select('id, author_type, author_id, body, created_at')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true });
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  return jsonOk({ messages: data ?? [] });
});

const PostMessageSchema = z.object({
  body: z.string().min(1).max(8000),
});

/**
 * Posts a message. RLS restricts inserts: customers reply as CUSTOMER on
 * their own tickets, staff as AGENT on any ticket.
 */
export const POST = withErrorHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await parseBody(request, PostMessageSchema);
  const supabase = await createSupabaseServerClient();

  const authorType = user.role === 'CUSTOMER' ? 'CUSTOMER' : 'AGENT';

  const { data: message, error } = await supabase
    .from('ticket_messages')
    .insert({
      ticket_id: id,
      author_id: user.userId,
      author_type: authorType,
      body: body.body,
    })
    .select('id, author_type, body, created_at')
    .single();
  if (error || !message) {
    throw new ApiError(403, 'FORBIDDEN', error?.message ?? 'Message rejected (RLS).');
  }

  // Conversation activity moves the ticket timestamp; staff replies may
  // transition OPEN → IN_PROGRESS.
  if (user.role !== 'CUSTOMER') {
    await supabase
      .from('tickets')
      .update({ status: 'IN_PROGRESS', assigned_to: user.userId })
      .eq('id', id)
      .eq('status', 'OPEN');
  }

  return jsonOk({ message }, 201);
});
