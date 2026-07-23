import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { evaluateDocumentExpiry } from "@/lib/documents/expiry-rules";
import { getExpiryRuleAction } from "@/lib/repositories/document-expiry-rule-repository";
import type { Prisma } from "@/generated/prisma/client";

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Real DB-backed queries only, no static/mock values — build brief GATE-002
 * ("real DB queries"). This is the single place the security dashboard's
 * numbers come from; the route handler does no aggregation of its own.
 */
export async function getSecurityDashboardData(tenantId: string) {
  const todayStart = startOfToday();

  const [
    gateEventsToday,
    vehiclesClearedToday,
    vehiclesDeniedToday,
    eventsAwaitingApproval,
    openHighSeverityExceptions,
    gpsInactiveVehicles,
    failedInspectionItemsToday,
    recentAuditActivity,
    expiringDocumentsRaw,
  ] = await Promise.all([
    prisma.gateEvent.count({ where: tenantWhere(tenantId, { createdAt: { gte: todayStart } } satisfies Prisma.GateEventWhereInput) }),
    prisma.gateEvent.count({
      where: tenantWhere(tenantId, { decision: "CLEARED", decisionAt: { gte: todayStart } } satisfies Prisma.GateEventWhereInput),
    }),
    prisma.gateEvent.count({
      where: tenantWhere(tenantId, { decision: "DENIED", decisionAt: { gte: todayStart } } satisfies Prisma.GateEventWhereInput),
    }),
    prisma.gateEvent.count({
      where: tenantWhere(tenantId, { status: { in: ["EXCEPTION_RAISED", "SUPERVISOR_REVIEW"] } } satisfies Prisma.GateEventWhereInput),
    }),
    prisma.exception.count({
      where: tenantWhere(tenantId, { resolvedAt: null, severity: { in: ["HIGH", "CRITICAL"] } } satisfies Prisma.ExceptionWhereInput),
    }),
    prisma.vehicle.findMany({
      where: tenantWhere(tenantId, { gpsStatus: "INACTIVE", archivedAt: null } satisfies Prisma.VehicleWhereInput),
      select: { id: true, registrationNumber: true, fleetNumber: true, gpsLastCommunicationAt: true },
      take: 25,
    }),
    prisma.gateEventInspectionItem.count({
      where: tenantWhere(tenantId, { outcome: "FAIL", recordedAt: { gte: todayStart } } satisfies Prisma.GateEventInspectionItemWhereInput),
    }),
    prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { timestamp: "desc" },
      take: 15,
      include: { user: { select: { name: true } } },
    }),
    prisma.complianceDocument.findMany({
      where: tenantWhere(tenantId, { archivedAt: null, expiryDate: { not: null } }),
      include: { driver: { select: { name: true } }, vehicle: { select: { registrationNumber: true } } },
      take: 200,
    }),
  ]);

  const expiryRuleCache = new Map<string, Awaited<ReturnType<typeof getExpiryRuleAction>>>();
  const expiringDocuments = [];
  for (const doc of expiringDocumentsRaw) {
    if (!expiryRuleCache.has(doc.documentType)) {
      expiryRuleCache.set(doc.documentType, await getExpiryRuleAction(tenantId, doc.documentType));
    }
    const action = expiryRuleCache.get(doc.documentType) ?? null;
    const evaluation = evaluateDocumentExpiry(doc.expiryDate, action);
    const daysUntilExpiry = doc.expiryDate ? Math.ceil((doc.expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
    // Surface anything already expired, or expiring within 30 days.
    if (evaluation.isExpired || (daysUntilExpiry !== null && daysUntilExpiry <= 30)) {
      expiringDocuments.push({
        id: doc.id,
        documentType: doc.documentType,
        expiryDate: doc.expiryDate,
        isExpired: evaluation.isExpired,
        configuredAction: action,
        ownerName: doc.driver?.name ?? doc.vehicle?.registrationNumber ?? "Unknown",
        ownerType: doc.ownerType,
      });
    }
  }
  expiringDocuments.sort((a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0));

  return {
    gateEventsToday,
    vehiclesClearedToday,
    vehiclesDeniedToday,
    eventsAwaitingApproval,
    openHighSeverityExceptions,
    gpsInactiveVehicles,
    failedInspectionItemsToday,
    expiringDocuments: expiringDocuments.slice(0, 25),
    recentAuditActivity: recentAuditActivity.map((a) => ({
      id: a.id,
      timestamp: a.timestamp,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      userName: a.user?.name ?? "System",
    })),
  };
}
