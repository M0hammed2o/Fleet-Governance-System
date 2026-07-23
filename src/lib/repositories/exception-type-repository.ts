import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import type { ExceptionSeverity, ExceptionOutcomeAction } from "@/generated/prisma/client";

/**
 * Tenant-configurable exception categories — same shape/purpose as
 * document-expiry-rule-repository.ts's DocumentExpiryRule (build brief GATE
 * item 3: "configurable per tenant"). `requiresSupervisorApproval` here is a
 * *default* a tenant sets per category; the hard self-approval rule itself
 * lives in gate-event-repository.ts and is never bypassable regardless of
 * this setting (see DECISIONS.md).
 */
export async function listExceptionTypesInTenant(tenantId: string) {
  return prisma.exceptionType.findMany({ where: tenantWhere(tenantId), orderBy: { label: "asc" } });
}

export async function getExceptionTypeInTenant(tenantId: string, exceptionTypeId: string) {
  return prisma.exceptionType.findFirst({ where: tenantWhere(tenantId, { id: exceptionTypeId }) });
}

export interface UpsertExceptionTypeInput {
  tenantId: string;
  code: string;
  label: string;
  description?: string | null;
  defaultSeverity: ExceptionSeverity;
  defaultOutcomeAction: ExceptionOutcomeAction;
  requiresSupervisorApproval: boolean;
  actorUserId: string;
}

export async function upsertExceptionType(input: UpsertExceptionTypeInput) {
  const result = await prisma.exceptionType.upsert({
    where: { tenantId_code: { tenantId: input.tenantId, code: input.code } },
    update: {
      label: input.label,
      description: input.description ?? null,
      defaultSeverity: input.defaultSeverity,
      defaultOutcomeAction: input.defaultOutcomeAction,
      requiresSupervisorApproval: input.requiresSupervisorApproval,
    },
    create: {
      tenantId: input.tenantId,
      code: input.code,
      label: input.label,
      description: input.description ?? null,
      defaultSeverity: input.defaultSeverity,
      defaultOutcomeAction: input.defaultOutcomeAction,
      requiresSupervisorApproval: input.requiresSupervisorApproval,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "exceptionType.upserted",
    entityType: "ExceptionType",
    entityId: result.id,
    afterValue: { code: result.code, defaultSeverity: result.defaultSeverity, requiresSupervisorApproval: result.requiresSupervisorApproval },
  });

  return result;
}
