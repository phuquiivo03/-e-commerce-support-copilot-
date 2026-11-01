'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, CircleAlert, Send, TriangleAlert, User } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { DraftPanel } from '@/components/tickets/draft-panel';
import { OrderRail } from '@/components/tickets/order-rail';

type Message = {
  id: string;
  author_type: 'CUSTOMER' | 'AGENT' | 'AI_DRAFT' | 'SYSTEM';
  author_id: string | null;
  body: string;
  created_at: string;
};

type TicketDetail = {
  ticket: {
    id: string;
    ticket_number: string;
    subject: string;
    category: string;
    priority: string;
    status: string;
    order_id: string | null;
    customers: { profiles: { full_name: string; email: string } | null; shipping_address: string | null } | null;
    orders: { id: string; order_number: string; status: string } | null;
  };
  messages: Message[];
  shipments: Array<{ id: string }>;
  shipmentEvents: Array<{ id: string; shipment_id: string; status: string; description: string; occurred_at: string }>;
  copilotRuns: Array<{ id: string; outcome: string; created_at: string }>;
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const ticketId = params.id;
  const queryClient = useQueryClient();

  const [composer, setComposer] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => apiFetch<TicketDetail>(`/api/tickets/${ticketId}`),
  });

  const sendMessage = useMutation({
    mutationFn: (body: string) =>
      apiFetch(`/api/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => {
      setComposer('');
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });

  const escalate = useMutation({
    mutationFn: () => apiFetch(`/api/tickets/${ticketId}`, { method: 'PUT' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] }),
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-6 lg:p-10">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-7xl p-6 lg:p-10">
        <Card tint="destructiveSoft" className="flex items-center gap-3">
          <CircleAlert className="h-5 w-5 shrink-0 text-destructive" />
          <div>
            <div className="font-bold">Ticket unavailable</div>
            <div className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Unknown error'}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const { ticket, messages } = data;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <Link
        href="/inbox"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to inbox
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-muted-foreground">{ticket.ticket_number}</span>
            <Badge tone={statusTone(ticket.status)}>{ticket.status.replace(/_/g, ' ')}</Badge>
            <Badge tone={statusTone(ticket.priority)}>{ticket.priority}</Badge>
            <Badge tone="neutral">{ticket.category.replace(/_/g, ' ')}</Badge>
          </div>
          <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ticket.customers?.profiles?.full_name ?? 'Unknown customer'}
            {ticket.orders ? ` · ${ticket.orders.order_number} (${ticket.orders.status})` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => escalate.mutate()}
            disabled={escalate.isPending || ticket.status === 'ESCALATED'}
          >
            <TriangleAlert className="h-4 w-4" />
            {ticket.status === 'ESCALATED' ? 'Escalated' : escalate.isPending ? 'Escalating…' : 'Escalate'}
          </Button>
        </div>
      </div>

      {escalate.isError ? (
        <p className="mt-2 text-sm font-medium text-destructive">
          {escalate.error instanceof Error ? escalate.error.message : 'Escalation failed.'}
        </p>
      ) : null}

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
        {/* Conversation + composer + draft */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-4" tint="muted">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversation</div>
            <ol className="space-y-3">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.author_type === 'AI_DRAFT'
                      ? 'rounded-md border-l-4 border-accent bg-background p-4'
                      : message.author_type === 'AGENT'
                        ? 'rounded-md border-l-4 border-secondary bg-background p-4'
                        : 'rounded-md border-l-4 border-primary bg-background p-4'
                  }
                >
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {message.author_type === 'AI_DRAFT' ? (
                      <>
                        <Bot className="h-3.5 w-3.5 text-accent-hover" /> AI draft
                      </>
                    ) : message.author_type === 'AGENT' ? (
                      <>
                        <User className="h-3.5 w-3.5 text-secondary" /> Agent
                      </>
                    ) : (
                      <>
                        <User className="h-3.5 w-3.5 text-primary" /> Customer
                      </>
                    )}
                    <span className="ml-auto font-medium normal-case">
                      {new Date(message.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[15px]">{message.body}</p>
                </li>
              ))}
            </ol>

            <div className="space-y-3">
              <Textarea
                placeholder="Write a reply to the customer…"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                rows={5}
                aria-label="Reply composer"
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => sendMessage.mutate(composer)}
                  disabled={composer.trim().length === 0 || sendMessage.isPending}
                >
                  <Send className="h-4 w-4" />
                  {sendMessage.isPending ? 'Sending…' : 'Send reply'}
                </Button>
              </div>
              {sendMessage.isError ? (
                <p className="text-sm font-medium text-destructive">
                  {sendMessage.error instanceof Error ? sendMessage.error.message : 'Send failed.'}
                </p>
              ) : null}
            </div>
          </Card>

          <DraftPanel ticketId={ticketId} />
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <Card tint="muted" className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Customer</div>
            <div className="font-bold">{ticket.customers?.profiles?.full_name ?? '—'}</div>
            <div className="text-sm text-muted-foreground">{ticket.customers?.profiles?.email ?? '—'}</div>
            {ticket.customers?.shipping_address ? (
              <div className="text-sm text-muted-foreground">{ticket.customers.shipping_address}</div>
            ) : null}
          </Card>

          <OrderRail ticketId={ticketId} orderId={ticket.order_id} shipmentEvents={data.shipmentEvents} />
        </div>
      </div>
    </div>
  );
}
