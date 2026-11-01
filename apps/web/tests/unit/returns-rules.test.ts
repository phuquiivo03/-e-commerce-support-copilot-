import { describe, expect, it } from 'vitest';
import { computeReturnEligibility, type EligibilityOrderContext } from '@/lib/copilot/rules/returns';

const deliveredRecently = (category: string, returnable = true): EligibilityOrderContext => ({
  orderId: 'o-1',
  orderNumber: 'ORD-1001',
  status: 'DELIVERED',
  deliveredAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  items: [
    { itemId: 'i-1', productName: 'Aurora Headphones', productCategory: category, productReturnable: returnable },
  ],
  activeReturnRequest: false,
});

describe('return eligibility rules', () => {
  it('is ELIGIBLE inside the electronics window (14 days)', () => {
    const result = computeReturnEligibility(deliveredRecently('Electronics'));
    expect(result.status).toBe('ELIGIBLE');
    expect(result.windowDeadline).not.toBeNull();
    expect(result.items[0]!.eligible).toBe(true);
  });

  it('is ELIGIBLE for default-category items within 30 days', () => {
    const result = computeReturnEligibility(deliveredRecently('Apparel'));
    expect(result.status).toBe('ELIGIBLE');
  });

  it('is NOT_ELIGIBLE past the electronics window', () => {
    const order = { ...deliveredRecently('Electronics'), deliveredAt: new Date(Date.now() - 15 * 86400000).toISOString() };
    const result = computeReturnEligibility(order);
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons[0]).toMatch(/closed on/);
  });

  it('is NOT_ELIGIBLE for final-sale products regardless of window', () => {
    const result = computeReturnEligibility(deliveredRecently('Clearance', false));
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons.join(' ')).toMatch(/final-sale\/non-returnable/);
  });

  it('is NOT_ELIGIBLE when an active return request already exists', () => {
    const result = computeReturnEligibility({ ...deliveredRecently('Apparel'), activeReturnRequest: true });
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons.join(' ')).toMatch(/already has an active return/);
  });

  it('is INDETERMINATE when the order is not delivered yet', () => {
    const result = computeReturnEligibility({ ...deliveredRecently('Electronics'), status: 'SHIPPED', deliveredAt: null });
    expect(result.status).toBe('INDETERMINATE');
    expect(result.missingInformation.join(' ')).toMatch(/has not been delivered/);
    expect(result.items[0]!.eligible).toBeNull();
  });

  it('is INDETERMINATE when the delivery date is missing on a delivered order', () => {
    const result = computeReturnEligibility({ ...deliveredRecently('Electronics'), deliveredAt: null });
    expect(result.status).toBe('INDETERMINATE');
  });

  it('handles mixed carts (one eligible item, one final-sale)', () => {
    const order = deliveredRecently('Electronics');
    order.items.push({ itemId: 'i-2', productName: 'Flash Speaker', productCategory: 'Clearance', productReturnable: false });
    const result = computeReturnEligibility(order);
    expect(result.status).toBe('ELIGIBLE');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.eligible).toBe(true);
    expect(result.items[1]!.eligible).toBe(false);
  });
});
