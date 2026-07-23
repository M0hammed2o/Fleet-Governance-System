import { prisma } from "@/lib/db/prisma";

interface RecordAuditInput {
  tenantId: string;
  userId?: string | null;
  ip?: string | null;
  sessionId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  reason?: string | null;
  correlationId?: string | null;
  relatedGateEventId?: string | null;
}

/**
 * Single write path for AuditLog. No other code in this codebase should call
 * prisma.auditLog directly — that keeps the "append-only, every field
 * populated" contract in one place. See ARCHITECTURE.md "Audit architecture".
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      ip: input.ip ?? null,
      sessionId: input.sessionId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeValue: input.beforeValue == null ? undefined : (input.beforeValue as object),
      afterValue: input.afterValue == null ? undefined : (input.afterValue as object),
      reason: input.reason ?? null,
      correlationId: input.correlationId ?? null,
      relatedGateEventId: input.relatedGateEventId ?? null,
    },
  });
}
