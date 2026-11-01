/**
 * Shared domain contracts between the web app, the evaluation suite, and the
 * ingestion worker. Enums mirror the Postgres enums defined in
 * supabase/migrations/20261030000002_schema.sql — keep them in sync.
 */
import { z } from 'zod';

export { tokenize, mockEmbed, toPgVectorLiteral } from './mock-embedding';

// ---------------------------------------------------------------------------
// Roles and statuses
// ---------------------------------------------------------------------------
export const USER_ROLES = ['ADMIN', 'SUPPORT_AGENT', 'CUSTOMER'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const SHIPMENT_STATUSES = [
  'PENDING',
  'IN_TRANSIT',
  'DELIVERED',
  'EXCEPTION',
  'RETURNED',
] as const;
export const ShipmentStatusSchema = z.enum(SHIPMENT_STATUSES);
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const TicketPrioritySchema = z.enum(TICKET_PRIORITIES);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const TICKET_CATEGORIES = [
  'ORDER_STATUS',
  'RETURNS',
  'REFUNDS',
  'SHIPPING',
  'WARRANTY',
  'OTHER',
] as const;
export const TicketCategorySchema = z.enum(TICKET_CATEGORIES);
export type TicketCategory = z.infer<typeof TicketCategorySchema>;

export const MESSAGE_AUTHORS = ['CUSTOMER', 'AGENT', 'AI_DRAFT', 'SYSTEM'] as const;
export const MessageAuthorSchema = z.enum(MESSAGE_AUTHORS);
export type MessageAuthor = z.infer<typeof MessageAuthorSchema>;

export const KB_DOCUMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'] as const;
export const KbDocumentStatusSchema = z.enum(KB_DOCUMENT_STATUSES);
export type KbDocumentStatus = z.infer<typeof KbDocumentStatusSchema>;

export const KB_DOCUMENT_CATEGORIES = [
  'SHIPPING',
  'CANCELLATION',
  'RETURNS',
  'REFUNDS',
  'WARRANTY',
] as const;
export const KbDocumentCategorySchema = z.enum(KB_DOCUMENT_CATEGORIES);
export type KbDocumentCategory = z.infer<typeof KbDocumentCategorySchema>;

export const RETURN_REQUEST_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export const ReturnRequestStatusSchema = z.enum(RETURN_REQUEST_STATUSES);
export type ReturnRequestStatus = z.infer<typeof ReturnRequestStatusSchema>;

export const INGESTION_JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export const IngestionJobStatusSchema = z.enum(INGESTION_JOB_STATUSES);
export type IngestionJobStatus = z.infer<typeof IngestionJobStatusSchema>;

// ---------------------------------------------------------------------------
// Copilot contract (Feature E). Every generated response validates against
// CopilotResponseSchema before it is persisted.
// ---------------------------------------------------------------------------
export const COPILOT_OUTCOMES = [
  'ANSWER',
  'CLARIFY',
  'PARTIAL_ANSWER',
  'ABSTAIN',
  'ESCALATE',
] as const;
export const CopilotOutcomeSchema = z.enum(COPILOT_OUTCOMES);
export type CopilotOutcome = z.infer<typeof CopilotOutcomeSchema>;

export const PolicyChunkCitationSchema = z.object({
  kind: z.literal('policy_chunk'),
  chunkId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  documentVersion: z.number().int().positive(),
  heading: z.string().nullable(),
  /** Verbatim quote copied from the referenced chunk content. */
  quote: z.string().min(1),
});
export type PolicyChunkCitation = z.infer<typeof PolicyChunkCitationSchema>;

export const OrderRecordCitationSchema = z.object({
  kind: z.literal('order_record'),
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  /** Names of the structured fields the answer relies on. */
  fields: z.array(z.string()).min(1),
});
export type OrderRecordCitation = z.infer<typeof OrderRecordCitationSchema>;

export const CitationSchema = z.discriminatedUnion('kind', [
  PolicyChunkCitationSchema,
  OrderRecordCitationSchema,
]);
export type Citation = z.infer<typeof CitationSchema>;

export const CopilotResponseSchema = z.object({
  behavior: CopilotOutcomeSchema,
  message: z.string().min(1),
  citations: z.array(CitationSchema).max(8).default([]),
  missingInformation: z.array(z.string()).default([]),
  suggestedNextActions: z.array(z.string()).default([]),
  requiresHumanReview: z.boolean().default(false),
});
export type CopilotResponse = z.infer<typeof CopilotResponseSchema>;

// ---------------------------------------------------------------------------
// Return eligibility contract (Feature F)
// ---------------------------------------------------------------------------
export const ReturnEligibilityStatusSchema = z.enum([
  'ELIGIBLE',
  'NOT_ELIGIBLE',
  'INDETERMINATE',
]);
export type ReturnEligibilityStatus = z.infer<typeof ReturnEligibilityStatusSchema>;

export const ReturnItemEligibilitySchema = z.object({
  itemId: z.string().uuid(),
  productName: z.string(),
  eligible: z.boolean().nullable(),
  reason: z.string(),
});
export type ReturnItemEligibility = z.infer<typeof ReturnItemEligibilitySchema>;

export const ReturnEligibilityResultSchema = z.object({
  status: ReturnEligibilityStatusSchema,
  reasons: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  windowDays: z.number().int().nullable(),
  windowDeadline: z.string().date().nullable(),
  items: z.array(ReturnItemEligibilitySchema).default([]),
  policyCitations: z
    .array(
      z.object({
        chunkId: z.string().uuid(),
        documentId: z.string().uuid(),
        documentTitle: z.string(),
        documentVersion: z.number().int(),
      })
    )
    .default([]),
});
export type ReturnEligibilityResult = z.infer<typeof ReturnEligibilityResultSchema>;

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PaginatedSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type Pagination = z.infer<typeof PaginatedSchema>;

// ---------------------------------------------------------------------------
// Auth (backend server contract — apps/server /api/v1/auth)
// ---------------------------------------------------------------------------
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Profile fields the API exposes — role always comes from the profiles table, never the client. */
export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  role: UserRoleSchema,
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Supabase session tokens, camelCased for the API surface. */
export const AuthSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  tokenType: z.string(),
  expiresIn: z.number().int().positive(),
  expiresAt: z.number().nullable(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const LoginResponseSchema = z.object({
  session: AuthSessionSchema,
  user: AuthUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/** What requireAuth attaches to the request after verifying the caller. */
export const AuthContextSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
  /** Present when role is CUSTOMER: the row id in public.customers (pk = profile_id). */
  customerId: z.string().uuid().optional(),
});
export type AuthContext = z.infer<typeof AuthContextSchema>;

export const MeResponseSchema = z.object({ user: AuthContextSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;
