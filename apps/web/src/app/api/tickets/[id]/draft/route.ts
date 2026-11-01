import { z } from 'zod';
import { ApiError, correlationId, jsonOk, parseBody, requireUser, withErrorHandler } from '@/lib/api/http';
import { runCopilotForTicket } from '@/lib/copilot/orchestrator';
import { recordAudit } from '@/lib/audit';

type RouteContext = { params: Promise<{ id: string }> };

const DraftSchema = z.object({
  question: z.string().min(1).max(4000).optional(),
});

/**
 * Generates an AI draft reply for a ticket (staff only). The orchestrator
 * runs entirely server-side: it authorizes the ticket, fetches structured
 * data through backend services, retrieves policy evidence, and validates
 * the structured output and citations before persisting the draft.
 */
export const POST = withErrorHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser(['ADMIN', 'SUPPORT_AGENT']);
  const { id } = await context.params;
  const body = await parseBody(request, DraftSchema);

  try {
    const result = await runCopilotForTicket({
      ticketId: id,
      triggeredBy: user.userId,
      question: body.question,
    });

    await recordAudit({
      actorId: user.userId,
      actorRole: user.role,
      action: 'copilot.draft_generated',
      entityType: 'ticket',
      entityId: id,
      metadata: {
        runId: result.runId,
        outcome: result.response.behavior,
        provider: result.provider,
        latencyMs: result.latencyMs,
        citations: result.response.citations.length,
      },
      correlationId: correlationId(request),
    });

    return jsonOk(result);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Ticket not found')) {
      throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found or not accessible.');
    }
    throw error;
  }
});
