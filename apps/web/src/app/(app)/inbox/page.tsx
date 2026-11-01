'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Inbox as InboxIcon, Search } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import type { TicketCategory, TicketPriority, TicketStatus } from '@copilot/shared';

type TicketRow = {
  id: string;
  ticket_number: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  orders: { order_number: string; status: string } | null;
  customers: { profiles: { full_name: string } | null } | null;
};

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const CATEGORY_OPTIONS = ['ORDER_STATUS', 'RETURNS', 'REFUNDS', 'SHIPPING', 'WARRANTY', 'OTHER'];

export default function InboxPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (category) params.set('category', category);
  params.set('pageSize', '50');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tickets', q, status, priority, category],
    queryFn: () =>
      apiFetch<{ tickets: TicketRow[]; total: number }>(`/api/tickets?${params.toString()}`),
  });

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Support Inbox</h1>
          <p className="mt-1 text-muted-foreground">
            {data ? `${data.total} ticket${data.total === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search subjects…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-10"
            aria-label="Search tickets"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </Select>
      </div>

      {isError ? (
        <Card tint="primarySoft" className="mt-6 flex items-center gap-3">
          <CircleAlert className="h-5 w-5 shrink-0 text-destructive" />
          <div>
            <div className="font-bold">Could not load the inbox</div>
            <div className="text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Unknown error'}</div>
          </div>
        </Card>
      ) : null}

      {isPending ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : null}

      {data && data.tickets.length === 0 ? (
        <Card tint="muted" className="mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background">
            <InboxIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="font-bold">No tickets match these filters</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Try clearing the search or picking a different status.
          </p>
        </Card>
      ) : null}

      <div className="mt-6 space-y-3">
        {data?.tickets.map((ticket) => (
          <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="block">
            <Card
              interactive
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">{ticket.ticket_number}</span>
                  <Badge tone={statusTone(ticket.priority)}>{ticket.priority}</Badge>
                  <Badge tone={statusTone(ticket.status)}>{ticket.status.replace(/_/g, ' ')}</Badge>
                  <Badge tone="neutral">{ticket.category.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="mt-1.5 truncate text-lg font-bold tracking-tight">{ticket.subject}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {ticket.customers?.profiles?.full_name ?? 'Unknown customer'}
                  {ticket.orders ? ` · ${ticket.orders.order_number} (${ticket.orders.status})` : ''}
                  {' · updated '}
                  {new Date(ticket.updated_at).toLocaleString()}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
