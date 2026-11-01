/**
 * Deterministic return-eligibility rules (Feature F).
 *
 * Pure functions only: all data is passed in, so the logic is unit-testable
 * without a database. The constants below mirror the published Returns &
 * Exchanges Policy v2 and must be updated together with it (documented in
 * docs/rag-pipeline.md).
 *
 * The result is INDETERMINATE — never guessed — when a required input such as
 * the delivery date is missing or policy applicability is ambiguous.
 */
import type { ReturnEligibilityResult, ReturnItemEligibility } from '@copilot/shared';

export const RETURN_WINDOWS: Record<string, number> = {
  Electronics: 14,
  DEFAULT: 30,
};

export type EligibilityOrderContext = {
  orderId: string;
  orderNumber: string;
  status: string;
  deliveredAt: string | null;
  items: Array<{
    itemId: string;
    productName: string;
    productCategory: string;
    productReturnable: boolean;
  }>;
  activeReturnRequest: boolean;
};

export function computeReturnEligibility(order: EligibilityOrderContext): ReturnEligibilityResult {
  const reasons: string[] = [];
  const missingInformation: string[] = [];

  if (order.status !== 'DELIVERED') {
    missingInformation.push(
      `Order ${order.orderNumber} has not been delivered yet (current status: ${order.status}); the return window starts on the delivery date.`
    );
    return {
      status: 'INDETERMINATE',
      reasons,
      missingInformation,
      windowDays: null,
      windowDeadline: null,
      items: order.items.map(
        (item): ReturnItemEligibility => ({
          itemId: item.itemId,
          productName: item.productName,
          eligible: null,
          reason: 'Return window cannot be evaluated before delivery.',
        })
      ),
      policyCitations: [],
    };
  }

  if (!order.deliveredAt) {
    missingInformation.push('Delivery date is not recorded for this order; the return window cannot be verified.');
    return {
      status: 'INDETERMINATE',
      reasons,
      missingInformation,
      windowDays: null,
      windowDeadline: null,
      items: order.items.map(
        (item): ReturnItemEligibility => ({
          itemId: item.itemId,
          productName: item.productName,
          eligible: null,
          reason: 'Missing delivery date.',
        })
      ),
      policyCitations: [],
    };
  }

  const deliveredAt = new Date(order.deliveredAt);
  const today = startOfUtcDay(new Date());

  if (order.activeReturnRequest) {
    reasons.push('This order already has an active return request under review; only one active request per order is allowed.');
  }

  const items = order.items.map((item): ReturnItemEligibility => {
    if (!item.productReturnable) {
      return {
        itemId: item.itemId,
        productName: item.productName,
        eligible: false,
        reason: `${item.productName} is final-sale/non-returnable (${item.productCategory}).`,
      };
    }
    const windowDays = RETURN_WINDOWS[item.productCategory] ?? RETURN_WINDOWS.DEFAULT!;
    const deadline = new Date(deliveredAt);
    deadline.setUTCDate(deadline.getUTCDate() + windowDays);
    const withinWindow = today <= startOfUtcDay(deadline);
    return {
      itemId: item.itemId,
      productName: item.productName,
      eligible: withinWindow,
      reason: withinWindow
        ? `Within the ${windowDays}-day return window (until ${isoDate(deadline)}).`
        : `The ${windowDays}-day return window for ${item.productCategory} closed on ${isoDate(deadline)}.`,
    };
  });

  const anyEligible = items.some((i) => i.eligible === true);
  const notEligibleOnly = items.length > 0 && items.every((i) => i.eligible === false);

  if (order.activeReturnRequest) {
    return {
      status: 'NOT_ELIGIBLE',
      reasons,
      missingInformation,
      windowDays: null,
      windowDeadline: null,
      items,
      policyCitations: [],
    };
  }

  if (anyEligible) {
    reasons.push(...items.filter((i) => i.eligible).map((i) => i.reason));
    return {
      status: 'ELIGIBLE',
      reasons,
      missingInformation,
      windowDays: null,
      windowDeadline: minDeadline(items),
      items,
      policyCitations: [],
    };
  }

  if (notEligibleOnly) {
    reasons.push(...items.map((i) => i.reason));
    return {
      status: 'NOT_ELIGIBLE',
      reasons,
      missingInformation,
      windowDays: null,
      windowDeadline: null,
      items,
      policyCitations: [],
    };
  }

  return {
    status: 'INDETERMINATE',
    reasons: [...reasons, 'Return eligibility could not be determined from the available data.'],
    missingInformation,
    windowDays: null,
    windowDeadline: null,
    items,
    policyCitations: [],
  };
}

function minDeadline(items: ReturnItemEligibility[]): string | null {
  const deadlines = items
    .filter((i) => i.eligible)
    .map((i) => /until (\d{4}-\d{2}-\d{2})/.exec(i.reason)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort();
  return deadlines[0] ?? null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
