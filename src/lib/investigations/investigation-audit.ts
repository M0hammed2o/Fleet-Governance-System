import "server-only";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record-audit";

interface RecordInvestigationEventInput {
  tenantId: string;
  caseId: string;
  actorUserId?: string | null;
  action: string;
  description: string;
  entityType?: string;
  entityId?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Single write path for both the platform AuditLog and a case's own
 * InvestigationChronologyEvent timeline (P11H) — every investigation
 * repository function that changes state calls this once, instead of
 * calling recordAudit() and prisma.investigationChronologyEvent.create()
 * separately. entityType/entityId default to the case itself; pass them
 * explicitly for a sub-entity event (e.g. a specific note or evidence item)
 * so the platform AuditLog's polymorphic pointer is precise, while the
 * chronology row is always caseId-scoped regardless.
 */
export async function recordInvestigationEvent(input: RecordInvestigationEventInput): Promise<void> {
  await Promise.all([
    recordAudit({
      tenantId: input.tenantId,
      userId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType ?? "InvestigationCase",
      entityId: input.entityId ?? input.caseId,
      beforeValue: input.beforeValue,
      afterValue: input.afterValue,
      reason: input.reason ?? null,
    }),
    prisma.investigationChronologyEvent.create({
      data: {
        tenantId: input.tenantId,
        caseId: input.caseId,
        eventType: input.action,
        description: input.description,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata as object | undefined,
      },
    }),
  ]);
}
