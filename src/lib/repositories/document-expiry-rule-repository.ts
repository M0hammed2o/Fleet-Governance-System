import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { ComplianceDocumentType, ExpiryRuleAction } from "@/generated/prisma/client";

export async function listExpiryRulesInTenant(tenantId: string) {
  return prisma.documentExpiryRule.findMany({ where: tenantWhere(tenantId), orderBy: { documentType: "asc" } });
}

export async function upsertExpiryRule(tenantId: string, documentType: ComplianceDocumentType, action: ExpiryRuleAction) {
  return prisma.documentExpiryRule.upsert({
    where: { tenantId_documentType: { tenantId, documentType } },
    update: { action },
    create: { tenantId, documentType, action },
  });
}

export async function getExpiryRuleAction(tenantId: string, documentType: ComplianceDocumentType): Promise<ExpiryRuleAction | null> {
  const rule = await prisma.documentExpiryRule.findUnique({ where: { tenantId_documentType: { tenantId, documentType } } });
  return rule?.action ?? null;
}
