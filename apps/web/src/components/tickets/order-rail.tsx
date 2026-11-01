'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Package, Truck, XCircle, CircleDashed } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { ReturnEligibilityResult } from '@copilot/shared';

type OrderSnapshot = {
  id: string;
  order_number: string;
  status: string;
  placed_at: string;
  total_cents: number;
  currency: string;
  delivered_at: string | null;
};

type Shipment = {
  id: string;
  tracking_number: string;
  status: string;
  carrier: string;
  estimated_delivery: string | null;
  delivered_at: string | null;
};

type ShipmentEvent = {
  id: string;
  shipment_id: string;
  status: string;
  description: string;
  occurred_at: string;
};

export function OrderRail({
  ticketId,
  orderId,
  shipmentEvents = [],
}: {
  ticketId: string;
  orderId: string | null;
  shipmentEvents?: ShipmentEvent[];
}) {
  const { data, isPending } = useQuery({
    queryKey: ['ticket-order', orderId],
    queryFn: () =>
      apiFetch<{
        order: OrderSnapshot;
        items: Array<{ id: string; quantity: number; unit_price_cents: number; products: { name: string; category: string } | { name: string; category: string }[] }>;
        payment: { status: string; amount_cents: number; last4: string | null; method: string } | null;
        shipments: Shipment[];
      }>(`/api/orders/${orderId}`),
    enabled: orderId !== null,
  });

  if (!orderId) {
    return (
      <Card tint="muted">
        <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Linked order</div>
        <p className="mt-2 text-sm">No order linked to this ticket yet.</p>
      </Card>
    );
  }

  if (isPending || !data) {
    return <Card tint="muted" className="h-40 animate-pulse" />;
  }

  const { order, items, payment, shipments } = data;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold tracking-tight">
            <Package className="h-5 w-5 text-primary" />
            {order.order_number}
          </div>
          <Badge tone={statusTone(order.status)}>{order.status}</Badge>
        </div>
        <dl className="space-y-1.5 text-sm">
          <Row label="Placed" value={new Date(order.placed_at).toLocaleDateString()} />
          <Row
            label="Delivered"
            value={order.delivered_at ? new Date(order.delivered_at).toLocaleDateString() : '—'}
          />
          <Row label="Total" value={`${order.currency} ${(order.total_cents / 100).toFixed(2)}`} />
        </dl>
        <div className="rounded-md bg-muted p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items</div>
          <ul className="mt-1.5 space-y-1 text-sm">
            {items.map((item) => {
              const product = Array.isArray(item.products) ? item.products[0] : item.products;
              return (
                <li key={item.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {item.quantity}× {product?.name ?? 'Unknown'}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{product?.category}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      {payment ? (
        <Card tint="primarySoft" className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold">
            <CreditCard className="h-5 w-5 text-primary" />
            Payment
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {payment.last4 ? `•••• ${payment.last4}` : payment.method}
            </span>
            <Badge tone={statusTone(payment.status)}>{payment.status.replace(/_/g, ' ')}</Badge>
          </div>
        </Card>
      ) : null}

      {shipments.map((shipment) => (
        <ShipmentCard
          key={shipment.id}
          shipment={shipment}
          events={shipmentEvents.filter((e) => e.shipment_id === shipment.id)}
        />
      ))}

      <ReturnCard orderId={order.id} ticketId={ticketId} />
    </div>
  );
}

function ShipmentCard({ shipment, events }: { shipment: Shipment; events: ShipmentEvent[] }) {
  return (
    <Card tint="muted" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold">
          <Truck className="h-5 w-5 text-secondary" />
          Shipment
        </div>
        <Badge tone={statusTone(shipment.status)}>{shipment.status.replace(/_/g, ' ')}</Badge>
      </div>
      <dl className="space-y-1.5 text-sm">
        <Row label="Tracking" value={shipment.tracking_number} />
        <Row label="Carrier" value={shipment.carrier} />
        <Row
          label="Est. delivery"
          value={shipment.estimated_delivery ? new Date(shipment.estimated_delivery).toLocaleDateString() : 'Not provided'}
        />
      </dl>
      {events.length > 0 ? (
        <ol className="space-y-2 border-l-4 border-border pl-4">
          {events.map((event) => (
            <li key={event.id} className="text-sm">
              <span className="font-semibold">{event.description}</span>
              <span className="block text-xs text-muted-foreground">
                {new Date(event.occurred_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

function ReturnCard({ orderId, ticketId }: { orderId: string; ticketId: string }) {
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ['return-eligibility', orderId],
    queryFn: () => apiFetch<{ eligibility: ReturnEligibilityResult }>(`/api/orders/${orderId}/return-eligibility`),
  });

  const createReturn = useMutation({
    mutationFn: () =>
      apiFetch<{ returnRequest: { id: string; status: string }; idempotentReplay: boolean }>('/api/returns', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          idempotencyKey: `agent-${ticketId.slice(0, 8)}-${crypto.randomUUID()}`,
          reason: 'Created by support agent from ticket workspace',
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['return-eligibility', orderId] });
    },
  });

  if (isPending) return <Card tint="muted" className="h-24 animate-pulse" />;
  if (isError || !data) return null;

  const { eligibility } = data;

  return (
    <Card
      tint={eligibility.status === 'ELIGIBLE' ? 'secondarySoft' : eligibility.status === 'NOT_ELIGIBLE' ? 'destructiveSoft' : 'accentSoft'}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="font-bold">Return eligibility</div>
        <Badge
          tone={eligibility.status === 'ELIGIBLE' ? 'secondary' : eligibility.status === 'NOT_ELIGIBLE' ? 'destructive' : 'accent'}
        >
          {eligibility.status.replace(/_/g, ' ')}
        </Badge>
      </div>
      {eligibility.reasons.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {eligibility.reasons.map((reason, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {eligibility.status === 'ELIGIBLE' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
      {eligibility.missingInformation.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {eligibility.missingInformation.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-accent-hover" />
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      {eligibility.status === 'ELIGIBLE' ? (
        <Button
          variant="success"
          size="sm"
          className="w-full"
          onClick={() => createReturn.mutate()}
          disabled={createReturn.isPending}
        >
          {createReturn.isPending ? 'Creating…' : 'Create return request'}
        </Button>
      ) : null}
      {createReturn.isError ? (
        <p className="text-sm font-medium text-destructive">
          {createReturn.error instanceof Error ? createReturn.error.message : 'Failed to create return request.'}
        </p>
      ) : null}
      {createReturn.isSuccess ? (
        <p className="text-sm font-semibold text-secondary">
          Return request created ({createReturn.data.returnRequest.status}).
        </p>
      ) : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}
