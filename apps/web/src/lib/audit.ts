import { createSupabaseServiceClient } from '@/lib/supabase/server';
import type { UserRole } from '@copilot/shared';

export type AuditInput = {
  actorId: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
};

/** Audit writes go through the service role: users cannot forge audit rows. */
export async function recordAudit(input: AuditInput): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from('audit_logs').insert({
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
    correlation_id: input.correlationId ?? null,
  });
  if (error) {
    // Audit failures must be loud, never silently swallowed.
    console.error('[audit] failed to record audit log', input.action, error.message);
  }
}
