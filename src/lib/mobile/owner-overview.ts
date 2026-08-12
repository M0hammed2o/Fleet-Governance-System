import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/authorize";
import type { Prisma } from "@/generated/prisma/client";

export async function getMobileOwnerOverview(session: AuthenticatedSession) {
  const now = new Date();
  const canInvestigate = await hasPermission(
    session,
    "investigationCase",
    "VIEW",
  );
  const [
    vehiclesOut,
    overdue,
    awaitingApproval,
    openExceptions,
    highRiskIndicators,
    vehicles,
    latestTracking,
    recentGateEvents,
    recentReconciliations,
    investigations,
  ] = await Promise.all([
    prisma.movementAuthorisation.findMany({
      where: tenantWhere(session.tenantId, {
        status: "IN_PROGRESS",
      } satisfies Prisma.MovementAuthorisationWhereInput),
      distinct: ["vehicleId"],
      select: { vehicleId: true },
    }),
    prisma.movementAuthorisation.count({
      where: tenantWhere(session.tenantId, {
        expectedReturnAt: { lt: now },
        status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"] },
      } satisfies Prisma.MovementAuthorisationWhereInput),
    }),
    prisma.movementAuthorisation.count({
      where: tenantWhere(session.tenantId, {
        status: "SUBMITTED",
      } satisfies Prisma.MovementAuthorisationWhereInput),
    }),
    prisma.exception.count({
      where: tenantWhere(session.tenantId, {
        resolvedAt: null,
      } satisfies Prisma.ExceptionWhereInput),
    }),
    prisma.analyticsIndicator.count({
      where: tenantWhere(session.tenantId, {
        severity: { in: ["HIGH", "CRITICAL"] },
        status: { not: "DISMISSED" },
      } satisfies Prisma.AnalyticsIndicatorWhereInput),
    }),
    prisma.vehicle.findMany({
      where: tenantWhere(session.tenantId, { archivedAt: null }),
      select: { id: true },
    }),
    prisma.telematicsEvent.findMany({
      where: tenantWhere(session.tenantId, {}),
      orderBy: { recordedAt: "desc" },
      select: {
        vehicleId: true,
        freshness: true,
        processingStatus: true,
        isSynthetic: true,
      },
    }),
    prisma.gateEvent.findMany({
      where: tenantWhere(session.tenantId, {}),
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        vehicle: { select: { registrationNumber: true } },
        gate: { select: { name: true } },
      },
    }),
    prisma.reconciliation.findMany({
      where: tenantWhere(session.tenantId, {}),
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { movementAuthorisation: { select: { referenceCode: true } } },
    }),
    canInvestigate
      ? prisma.investigationCase.findMany({
          where: tenantWhere(session.tenantId, {}),
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            caseNumber: true,
            title: true,
            status: true,
            priority: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const latestByVehicle = new Map<string, (typeof latestTracking)[number]>();
  for (const event of latestTracking)
    if (!latestByVehicle.has(event.vehicleId))
      latestByVehicle.set(event.vehicleId, event);
  let fresh = 0,
    stale = 0,
    unavailable = 0,
    synthetic = 0;
  for (const vehicle of vehicles) {
    const event = latestByVehicle.get(vehicle.id);
    if (!event || event.processingStatus !== "ACCEPTED") unavailable++;
    else if (event.freshness === "FRESH") fresh++;
    else stale++;
    if (event?.isSynthetic) synthetic++;
  }
  return {
    counts: {
      vehiclesOut: vehiclesOut.length,
      overdue,
      awaitingApproval,
      openExceptions,
      highRiskIndicators,
    },
    tracker: { fresh, stale, unavailable, synthetic },
    recentActivity: recentGateEvents.map((event) => ({
      id: event.id,
      label: `${event.vehicle.registrationNumber} at ${event.gate.name}`,
      occurredAt: event.createdAt.toISOString(),
      outcome: event.decision ?? event.status,
    })),
    recentReconciliations: recentReconciliations.map((item) => ({
      id: item.id,
      referenceCode: item.movementAuthorisation.referenceCode,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    })),
    investigationSummaries: investigations.map((item) => ({
      id: item.id,
      caseNumber: item.caseNumber,
      title: item.title,
      status: item.status,
      severity: item.priority,
    })),
  };
}
