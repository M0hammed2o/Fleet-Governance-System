import "server-only";
import { prisma } from "@/lib/db/prisma";
import { calculateDriverGovernanceRating } from "@/lib/ratings/driver-rating";

export async function calculateRatingsForTenant(tenantId: string, now = new Date()) {
  const [drivers, exceptions, failedInspections, deniedGateEvents, discrepancies, indicators] = await Promise.all([
    prisma.driver.findMany({
      where: { tenantId, archivedAt: null },
      include: {
        vehicleAssignments: { where: { status: "ACTIVE", effectiveTo: null }, include: { vehicle: true }, take: 1 },
        assignedVehicles: { where: { archivedAt: null }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.exception.findMany({ where: { tenantId, resolvedAt: null, gateEvent: { isNot: null } }, select: { severity: true, gateEvent: { select: { driverId: true } } } }),
    prisma.gateEventInspectionItem.findMany({ where: { tenantId, outcome: "FAIL" }, select: { gateEvent: { select: { driverId: true } } } }),
    prisma.gateEvent.findMany({ where: { tenantId, decision: "DENIED" }, select: { driverId: true } }),
    prisma.reconciliationDiscrepancy.findMany({
      where: { tenantId, status: "OPEN" },
      select: { reconciliation: { select: { departureGateEvent: { select: { driverId: true } }, returnGateEvent: { select: { driverId: true } } } } },
    }),
    prisma.analyticsIndicator.findMany({ where: { tenantId, subjectType: "DRIVER", status: { in: ["OPEN", "ESCALATED"] }, severity: { in: ["HIGH", "CRITICAL"] } }, select: { subjectId: true } }),
  ]);

  return drivers.map((driver) => {
    const activeAssignment = driver.vehicleAssignments[0];
    const currentVehicle = activeAssignment?.vehicle ?? driver.assignedVehicles[0] ?? null;
    const driverExceptions = exceptions.filter((entry) => entry.gateEvent?.driverId === driver.id);
    const rating = calculateDriverGovernanceRating({
      employeeNumber: driver.employeeNumber,
      contactPhone: driver.contactPhone,
      contactEmail: driver.contactEmail,
      licenceNumber: driver.licenceNumber,
      licenceExpiry: driver.licenceExpiry,
      pdpStatus: driver.pdpStatus,
      pdpExpiry: driver.pdpExpiry,
      hasCurrentVehicle: Boolean(currentVehicle),
      openCriticalExceptions: driverExceptions.filter((entry) => entry.severity === "CRITICAL").length,
      openHighExceptions: driverExceptions.filter((entry) => entry.severity === "HIGH").length,
      failedInspections: failedInspections.filter((entry) => entry.gateEvent.driverId === driver.id).length,
      deniedGateEvents: deniedGateEvents.filter((entry) => entry.driverId === driver.id).length,
      openDiscrepancies: discrepancies.filter((entry) => entry.reconciliation.departureGateEvent.driverId === driver.id || entry.reconciliation.returnGateEvent.driverId === driver.id).length,
      seriousGovernanceIndicators: indicators.filter((entry) => entry.subjectId === driver.id).length,
    }, now);
    return {
      driver: { id: driver.id, name: driver.name, employeeNumber: driver.employeeNumber, portraitMediaAssetId: driver.portraitMediaAssetId, status: driver.status },
      currentVehicle: currentVehicle ? { id: currentVehicle.id, registrationNumber: currentVehicle.registrationNumber, fleetNumber: currentVehicle.fleetNumber, category: currentVehicle.category, operationalStatus: currentVehicle.operationalStatus } : null,
      rating,
    };
  });
}

export async function calculateRatingForDriver(tenantId: string, driverId: string, now = new Date()) {
  const all = await calculateRatingsForTenant(tenantId, now);
  return all.find((entry) => entry.driver.id === driverId) ?? null;
}
