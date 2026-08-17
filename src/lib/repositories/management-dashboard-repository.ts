import "server-only";
import { prisma } from "@/lib/db/prisma";
import { calculateRatingsForTenant } from "@/lib/repositories/driver-rating-repository";

export async function getManagementDashboard(tenantId: string, now = new Date()) {
  const warningDate = new Date(now.getTime() + 45 * 86_400_000);
  const [tenant, totalVehicles, activeVehicles, unavailableVehicles, totalDrivers, assignedDrivers, expiringDocuments, openExceptions, recentGateEvents, ratings] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, demoWorkspace: true, onboardingProgress: { select: { declaredFleetSize: true, completedAt: true } } } }),
    prisma.vehicle.count({ where: { tenantId, archivedAt: null } }),
    prisma.vehicle.count({ where: { tenantId, archivedAt: null, operationalStatus: "OPERATIONAL" } }),
    prisma.vehicle.count({ where: { tenantId, archivedAt: null, operationalStatus: { not: "OPERATIONAL" } } }),
    prisma.driver.count({ where: { tenantId, archivedAt: null } }),
    prisma.driverVehicleAssignment.count({ where: { tenantId, status: "ACTIVE", effectiveTo: null } }),
    prisma.complianceDocument.count({ where: { tenantId, archivedAt: null, expiryDate: { lte: warningDate } } }),
    prisma.exception.count({ where: { tenantId, resolvedAt: null } }),
    prisma.gateEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, direction: true, status: true, decision: true, createdAt: true, driver: { select: { name: true } }, vehicle: { select: { registrationNumber: true } }, gate: { select: { name: true } } },
    }),
    calculateRatingsForTenant(tenantId, now),
  ]);
  if (!tenant) return null;
  const declared = tenant.onboardingProgress?.declaredFleetSize ?? totalVehicles;
  return {
    tenant,
    metrics: {
      totalVehicles,
      declaredVehicles: declared,
      outstandingVehicles: Math.max(0, declared - totalVehicles),
      activeVehicles,
      unavailableVehicles,
      totalDrivers,
      assignedDrivers,
      unassignedDrivers: Math.max(0, totalDrivers - assignedDrivers),
      expiringDocuments,
      openExceptions,
    },
    recentGateEvents,
    ratings,
  };
}
