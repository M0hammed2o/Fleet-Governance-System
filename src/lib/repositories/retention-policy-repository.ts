import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import type { MediaCategory } from "@/generated/prisma/client";

// Default media evidence retention (Phase 8C, ARCHITECTURE.md "Retention
// architecture"): rolling 12 months. A tenant only needs a RetentionPolicy
// row to *override* this default for a given category, not to have one at
// all times — replaces the single tenant-wide `Tenant.retentionDays`
// assumption (SECURITY_AND_POPIA.md's flagged "may need to be per data
// category").
export const DEFAULT_RETENTION_DAYS = 365;

export interface EffectiveRetentionPolicy {
  category: MediaCategory;
  retentionDays: number;
  includedStorageAllowanceBytes: number | null;
  archiveEligible: boolean;
  isDefault: boolean;
}

export async function getEffectiveRetentionPolicy(tenantId: string, category: MediaCategory): Promise<EffectiveRetentionPolicy> {
  const policy = await prisma.retentionPolicy.findUnique({ where: { tenantId_category: { tenantId, category } } });
  if (policy) {
    return {
      category,
      retentionDays: policy.retentionDays,
      includedStorageAllowanceBytes: policy.includedStorageAllowanceBytes,
      archiveEligible: policy.archiveEligible,
      isDefault: false,
    };
  }
  return { category, retentionDays: DEFAULT_RETENTION_DAYS, includedStorageAllowanceBytes: null, archiveEligible: true, isDefault: true };
}

export async function listRetentionPoliciesInTenant(tenantId: string) {
  return prisma.retentionPolicy.findMany({ where: tenantWhere(tenantId), orderBy: { category: "asc" } });
}

export interface UpsertRetentionPolicyInput {
  tenantId: string;
  actorUserId: string;
  category: MediaCategory;
  retentionDays?: number;
  includedStorageAllowanceBytes?: number | null;
  archiveEligible?: boolean;
}

export async function upsertRetentionPolicy(input: UpsertRetentionPolicyInput) {
  const existing = await prisma.retentionPolicy.findUnique({ where: { tenantId_category: { tenantId: input.tenantId, category: input.category } } });

  const policy = await prisma.retentionPolicy.upsert({
    where: { tenantId_category: { tenantId: input.tenantId, category: input.category } },
    create: {
      tenantId: input.tenantId,
      category: input.category,
      retentionDays: input.retentionDays ?? DEFAULT_RETENTION_DAYS,
      includedStorageAllowanceBytes: input.includedStorageAllowanceBytes ?? null,
      archiveEligible: input.archiveEligible ?? true,
    },
    update: {
      ...(input.retentionDays != null ? { retentionDays: input.retentionDays } : {}),
      ...(input.includedStorageAllowanceBytes !== undefined ? { includedStorageAllowanceBytes: input.includedStorageAllowanceBytes } : {}),
      ...(input.archiveEligible != null ? { archiveEligible: input.archiveEligible } : {}),
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: existing ? "retention.policyUpdated" : "retention.policyCreated",
    entityType: "RetentionPolicy",
    entityId: policy.id,
    beforeValue: existing ? { retentionDays: existing.retentionDays, archiveEligible: existing.archiveEligible } : null,
    afterValue: { category: policy.category, retentionDays: policy.retentionDays, archiveEligible: policy.archiveEligible },
  });

  return policy;
}
