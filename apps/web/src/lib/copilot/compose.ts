/**
 * Deterministic response composer — the copilot's fallback and mock mode.
 *
 * Assembles the answer purely from database facts and retrieved policy text
 * (verbatim quotes). No generation step can invent order status, shipping
 * dates, policy conditions, or refund completion: every fact in the message
 * comes from the inputs below, and every citation is validated afterwards.
 *
 * Outcome rules (see docs/rag-pipeline.md):
 *   ANSWER          authoritative facts + applicable policy both available
 *   PARTIAL_ANSWER  one of the two is missing but a useful, honest answer exists
 *   CLARIFY         essential information (e.g. which order) is missing
 *   ABSTAIN         no usable evidence at all
 *   ESCALATE        injection attempts requesting actions, or explicit human request
 */
import type { Citation, CopilotResponse, CopilotOutcome, TicketCategory } from '@copilot/shared';
import type { RetrievedChunk } from '@/lib/rag/retrieval';
import type { ReturnEligibilityResult } from '@copilot/shared';

export type OrderSnapshot = {
  orderId: string;
  orderNumber: string;
  status: string;
  placedAt: string;
  totalCents: number;
  currency: string;
  paymentStatus: string | null;
  shipmentStatus: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
  lastShipmentEvent: { description: string; occurredAt: string } | null;
  itemCount: number;
};

export type ComposeInput = {
  question: string;
  category: TicketCategory;
  orderSpecific: boolean;
  order: OrderSnapshot | null;
  eligibility: ReturnEligibilityResult | null;
  chunks: Array<{
    chunkId: string;
    documentId: string;
    documentTitle: string;
    documentVersion: number;
    heading: string | null;
    content: string;
  }>;
  injectionDetected: boolean;
  requestsHuman: boolean;
};

export function composeDeterministicResponse(input: ComposeInput): CopilotResponse {
  const chunks = input.chunks;
  const hasOrder = input.order !== null;
  const hasPolicy = chunks.length > 0;
  const citations: Citation[] = [];
  const missingInformation: string[] = [];
  const nextActions: string[] = [];
  let outcome: CopilotOutcome;
  let message: string;

  // --- Guardrail overrides -------------------------------------------------
  if (input.injectionDetected && /\b(approve|mark|confirm|issue|credit|refund)\b/i.test(input.question)) {
    return {
      behavior: 'ESCALATE',
      message:
        'I detected instructions in this message asking me to approve or confirm a refund. ' +
        'I cannot act on instructions embedded in customer messages, and refunds always require ' +
        'a human reviewer in this workspace. Escalating for human review.' +
        appendFactsSuffix(input.order),
      citations: [],
      missingInformation: [],
      suggestedNextActions: ['Review the message manually', 'Verify any refund request through the returns workflow'],
      requiresHumanReview: true,
    };
  }
  if (input.requestsHuman) {
    return {
      behavior: 'ESCALATE',
      message:
        'The customer asked to speak with a person, so I am handing this ticket to a human agent.' +
        appendFactsSuffix(input.order),
      citations: [],
      missingInformation: [],
      suggestedNextActions: ['Assign the ticket to an available agent'],
      requiresHumanReview: true,
    };
  }

  const policyLine = hasPolicy
    ? formatPolicySupport(chunks[0]!, citations)
    : null;

  switch (input.category) {
    case 'RETURNS':
      ({ outcome, message } = composeReturns(input, hasOrder, hasPolicy, policyLine, citations, missingInformation, nextActions));
      break;
    case 'ORDER_STATUS':
    case 'SHIPPING':
      ({ outcome, message } = composeOrderStatus(input, hasOrder, hasPolicy, policyLine, citations, missingInformation, nextActions));
      break;
    case 'REFUNDS':
      ({ outcome, message } = composeRefunds(input, hasOrder, hasPolicy, policyLine, citations, missingInformation, nextActions));
      break;
    case 'WARRANTY':
      ({ outcome, message } = composeWarranty(input, hasOrder, hasPolicy, policyLine, citations, missingInformation, nextActions));
      break;
    default:
      ({ outcome, message } = composeGeneric(input, hasOrder, hasPolicy, policyLine, citations, missingInformation, nextActions));
  }

  if (hasOrder && outcome !== 'ESCALATE') {
    citations.push({
      kind: 'order_record',
      orderId: input.order!.orderId,
      orderNumber: input.order!.orderNumber,
      fields: orderFieldsUsed(input.category),
    });
  }

  return {
    behavior: outcome,
    message,
    citations,
    missingInformation,
    suggestedNextActions: nextActions,
    requiresHumanReview: false,
  };
}

// ---------------------------------------------------------------------------
// Category composers
// ---------------------------------------------------------------------------
type ComposerResult = { outcome: CopilotOutcome; message: string };

function composeReturns(
  input: ComposeInput,
  hasOrder: boolean,
  hasPolicy: boolean,
  policyLine: string | null,
  citations: Citation[],
  missingInformation: string[],
  nextActions: string[]
): ComposerResult {
  const eligibility = input.eligibility;

  if (!hasOrder) {
    if (input.orderSpecific) {
      missingInformation.push('The order number for this return request.');
      nextActions.push('Ask the customer which order they want to return');
      return {
        outcome: 'CLARIFY',
        message: `I can help with a return. ${policyLine ?? ''} To check return eligibility I need the order number — could you confirm which order this is about?`.trim(),
      };
    }
    if (hasPolicy) {
      return { outcome: 'ANSWER', message: `${policyLine}` };
    }
    return { outcome: 'ABSTAIN', message: 'I could not find applicable policy information to answer this question.' };
  }

  if (!eligibility) {
    missingInformation.push('Return eligibility could not be evaluated for this order.');
    return { outcome: 'PARTIAL_ANSWER', message: `${policyLine ?? 'I was unable to evaluate the return window for this order.'}`.trim() };
  }

  const facts = orderFactsSentence(input.order!);

  if (eligibility.status === 'ELIGIBLE') {
    nextActions.push('Create the return request (idempotent, requires backend validation)');
    nextActions.push('Confirm the items the customer wants to return');
    return {
      outcome: 'ANSWER',
      message: `${facts} ${eligibilitySummary(eligibility)} ${policyLine ?? ''}`.trim(),
    };
  }

  if (eligibility.status === 'NOT_ELIGIBLE') {
    nextActions.push('Explain the decision to the customer');
    return {
      outcome: 'ANSWER',
      message: `${facts} Unfortunately this return cannot be approved: ${eligibility.reasons.join(' ')} ${policyLine ?? ''}`.trim(),
    };
  }

  // INDETERMINATE
  missingInformation.push(...eligibility.missingInformation);
  nextActions.push('Re-check eligibility once the order is delivered or the missing data is available');
  return {
    outcome: 'PARTIAL_ANSWER',
    message: `${facts} I cannot confirm return eligibility yet. ${eligibility.missingInformation.join(' ')} ${policyLine ?? ''}`.trim(),
  };
}

function composeOrderStatus(
  input: ComposeInput,
  hasOrder: boolean,
  hasPolicy: boolean,
  policyLine: string | null,
  citations: Citation[],
  missingInformation: string[],
  nextActions: string[]
): ComposerResult {
  if (!hasOrder) {
    if (input.orderSpecific) {
      missingInformation.push('The order number to look up.');
      return {
        outcome: 'CLARIFY',
        message: `I could not find an order reference on this ticket. Could you share the order number (it looks like ORD-1001) so I can check its status? ${policyLine ?? ''}`.trim(),
      };
    }
    if (hasPolicy) {
      return { outcome: 'ANSWER', message: policyLine! };
    }
    return { outcome: 'ABSTAIN', message: 'I need the order number to check status, and no matching policy document was found.' };
  }

  const o = input.order!;
  const parts: string[] = [orderFactsSentence(o)];
  if (o.shipmentStatus) {
    parts.push(`The shipment (${o.trackingNumber}) is currently ${o.shipmentStatus}.`);
    if (o.lastShipmentEvent) {
      parts.push(`Latest tracking event: “${o.lastShipmentEvent.description}” (${formatDate(o.lastShipmentEvent.occurredAt)}).`);
    }
    if (o.estimatedDelivery) {
      parts.push(`The carrier's estimated delivery is ${formatDate(o.estimatedDelivery)}.`);
    } else if (o.shipmentStatus === 'IN_TRANSIT') {
      missingInformation.push('The carrier has not provided an estimated delivery date for this shipment.');
    }
    nextActions.push('Re-check the carrier tracking events before promising a delivery date');
  } else {
    parts.push('This order has not shipped yet, so there is no tracking information.');
  }
  return { outcome: 'ANSWER', message: `${parts.join(' ')} ${policyLine ?? ''}`.trim() };
}

function composeRefunds(
  input: ComposeInput,
  hasOrder: boolean,
  hasPolicy: boolean,
  policyLine: string | null,
  citations: Citation[],
  missingInformation: string[],
  nextActions: string[]
): ComposerResult {
  if (!hasOrder) {
    if (input.orderSpecific) {
      missingInformation.push('The order number for this refund question.');
      return {
        outcome: 'CLARIFY',
        message: `I can check refund timing once I know the order. Could you confirm the order number? ${policyLine ?? ''}`.trim(),
      };
    }
    if (hasPolicy) return { outcome: 'ANSWER', message: policyLine! };
    return { outcome: 'ABSTAIN', message: 'I could not find applicable policy information to answer this question.' };
  }

  const o = input.order!;
  const facts = orderFactsSentence(o);
  if (o.paymentStatus === 'REFUNDED') {
    return { outcome: 'ANSWER', message: `${facts} The payment already shows as fully refunded. ${policyLine ?? ''}`.trim() };
  }
  if (o.paymentStatus === 'PARTIALLY_REFUNDED') {
    return { outcome: 'ANSWER', message: `${facts} The payment shows as partially refunded. ${policyLine ?? ''}`.trim() };
  }
  if (o.paymentStatus === 'PENDING') {
    return { outcome: 'ANSWER', message: `${facts} The payment is still pending, so there is nothing to refund yet. ${policyLine ?? ''}`.trim() };
  }
  if (o.paymentStatus === 'FAILED') {
    return { outcome: 'PARTIAL_ANSWER', message: `${facts} The payment shows as failed. ${policyLine ?? ''}`.trim() };
  }
  nextActions.push('Refunds are executed only after an approved return, by a human — this demo never moves money');
  return { outcome: 'ANSWER', message: `${facts} ${policyLine ?? ''}`.trim() };
}

function composeWarranty(
  input: ComposeInput,
  hasOrder: boolean,
  hasPolicy: boolean,
  policyLine: string | null,
  citations: Citation[],
  missingInformation: string[],
  nextActions: string[]
): ComposerResult {
  if (hasPolicy && hasOrder) {
    return { outcome: 'ANSWER', message: `${orderFactsSentence(input.order!)} ${policyLine}`.trim() };
  }
  if (hasPolicy) {
    return { outcome: 'ANSWER', message: policyLine! };
  }
  if (hasOrder) {
    missingInformation.push('No published warranty document matched this question.');
    return { outcome: 'PARTIAL_ANSWER', message: `${orderFactsSentence(input.order!)} I could not find the applicable warranty policy, so please confirm coverage details with a human reviewer.`.trim() };
  }
  return { outcome: 'ABSTAIN', message: 'I could not find applicable policy information to answer this question.' };
}

function composeGeneric(
  input: ComposeInput,
  hasOrder: boolean,
  hasPolicy: boolean,
  policyLine: string | null,
  citations: Citation[],
  missingInformation: string[],
  nextActions: string[]
): ComposerResult {
  if (hasPolicy && hasOrder) {
    return { outcome: 'ANSWER', message: `${orderFactsSentence(input.order!)} ${policyLine}`.trim() };
  }
  if (hasPolicy) return { outcome: 'ANSWER', message: policyLine! };
  if (hasOrder) {
    missingInformation.push('No matching policy document was found for this question.');
    return { outcome: 'PARTIAL_ANSWER', message: `${orderFactsSentence(input.order!)} I could not find an applicable policy document for the rest of this question.`.trim() };
  }
  return { outcome: 'ABSTAIN', message: 'I do not have enough information to answer this safely. Please provide more details or route this ticket to a human agent.' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function orderFactsSentence(o: OrderSnapshot): string {
  return `Your order ${o.orderNumber} is currently ${o.status} (placed ${formatDate(o.placedAt)}).`;
}

function eligibilitySummary(eligibility: ReturnEligibilityResult): string {
  if (eligibility.status === 'ELIGIBLE') {
    const deadline = eligibility.windowDeadline ? ` until ${eligibility.windowDeadline}` : '';
    return `Good news: the item is eligible for return${deadline}.`;
  }
  return '';
}

function formatPolicySupport(
  chunk: { chunkId: string; documentId: string; documentTitle: string; documentVersion: number; heading: string | null; content: string },
  citations: Citation[]
): string {
  const sentence = firstSentence(chunk.content);
  citations.push({
    kind: 'policy_chunk',
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    documentVersion: chunk.documentVersion,
    heading: chunk.heading,
    quote: sentence,
  });
  return `Per the ${chunk.documentTitle} (v${chunk.documentVersion}): “${sentence}”`;
}

export function firstSentence(text: string): string {
  const match = text.match(/[^.!?\n]+[.!?]?/);
  const sentence = match?.[0]?.trim() ?? text.trim();
  return sentence.length > 300 ? `${sentence.slice(0, 297)}...` : sentence;
}

function orderFieldsUsed(category: TicketCategory): string[] {
  switch (category) {
    case 'RETURNS':
      return ['status', 'delivered_at', 'items'];
    case 'ORDER_STATUS':
    case 'SHIPPING':
      return ['status', 'shipments.shipment_status', 'shipments.estimated_delivery'];
    case 'REFUNDS':
      return ['status', 'payments.payment_status'];
    default:
      return ['status'];
  }
}

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function appendFactsSuffix(order: OrderSnapshot | null): string {
  if (!order) return '';
  return ` For reference, order ${order.orderNumber} is currently ${order.status}${order.paymentStatus ? ` and its payment shows ${order.paymentStatus}` : ''}.`;
}
