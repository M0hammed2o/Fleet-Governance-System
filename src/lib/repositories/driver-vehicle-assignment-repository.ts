import "server-only";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record-audit";

export class AssignmentConflictError extends Error {
  constructor(message = "The driver or vehicle already has an active assignment.") {
    super(message);
    this.name = "AssignmentConflictError";
  }
}
export class AssignmentOwnershipError extends Error {}
export class AssignmentChronologyError extends Error {}

export async function listAssignmentsInTenant(tenantId: string, filters: { driverId?: string; vehicleId?: string; activeOnly?: boolean } = {}) {
  return prisma.driverVehicleAssignment.findMany({
    where: {
      tenantId,
      ...(filters.driverId ? { driverId: filters.driverId } : {}),
      ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
      ...(filters.activeOnly ? { status: "ACTIVE", effectiveTo: null } : {}),
    },
    include: {
      driver: { select: { id: true, name: true, employeeNumber: true } },
      vehicle: { select: { id: true, registrationNumber: true, fleetNumber: true, category: true } },
      assignedBy: { select: { id: true, name: true } },
      endedBy: { select: { id: true, name: true } },
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

function uniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function assignDriverToVehicle(input: {
  tenantId: string;
  driverId: string;
  vehicleId: string;
  actorUserId: string;
  effectiveFrom?: Date;
  reason: string;
  replaceExisting: boolean;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const [driver, vehicle] = await Promise.all([
        tx.driver.findFirst({ where: { id: input.driverId, tenantId: input.tenantId, archivedAt: null } }),
        tx.vehicle.findFirst({ where: { id: input.vehicleId, tenantId: input.tenantId, archivedAt: null } }),
      ]);
      if (!driver || !vehicle) throw new AssignmentOwnershipError("The selected driver or vehicle does not belong to this company.");
      if (driver.status !== "ACTIVE") throw new AssignmentConflictError("Only an active driver can be assigned.");
      if (vehicle.operationalStatus === "DECOMMISSIONED") throw new AssignmentConflictError("A decommissioned vehicle cannot be assigned.");

      const effectiveFrom = input.effectiveFrom ?? new Date();
      const conflicts = await tx.driverVehicleAssignment.findMany({
        where: {
          tenantId: input.tenantId,
          status: "ACTIVE",
          effectiveTo: null,
          OR: [{ driverId: input.driverId }, { vehicleId: input.vehicleId }],
        },
      });
      if (conflicts.length && !input.replaceExisting) throw new AssignmentConflictError();

      if (conflicts.length) {
        for (const conflict of conflicts) {
          if (effectiveFrom < conflict.effectiveFrom) throw new AssignmentChronologyError("Reassignment cannot end an assignment before it started.");
          await tx.driverVehicleAssignment.update({
            where: { id: conflict.id },
            data: { status: "ENDED", effectiveTo: effectiveFrom, endReason: input.reason, endedByUserId: input.actorUserId },
          });
          await tx.vehicle.updateMany({
            where: { id: conflict.vehicleId, tenantId: input.tenantId, assignedDriverId: conflict.driverId },
            data: { assignedDriverId: null },
          });
          await recordAudit({
            tenantId: input.tenantId,
            userId: input.actorUserId,
            action: "driverVehicleAssignment.endedForReassignment",
            entityType: "DriverVehicleAssignment",
            entityId: conflict.id,
            reason: input.reason,
            afterValue: { effectiveTo: effectiveFrom, status: "ENDED" },
          }, tx);
        }
      }

      const assignment = await tx.driverVehicleAssignment.create({
        data: {
          tenantId: input.tenantId,
          driverId: input.driverId,
          vehicleId: input.vehicleId,
          assignedByUserId: input.actorUserId,
          effectiveFrom,
          reason: input.reason,
          status: "ACTIVE",
        },
      });
      await tx.vehicle.update({ where: { id: vehicle.id }, data: { assignedDriverId: driver.id } });
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorUserId,
        action: "driverVehicleAssignment.created",
        entityType: "DriverVehicleAssignment",
        entityId: assignment.id,
        reason: input.reason,
        afterValue: { driverId: input.driverId, vehicleId: input.vehicleId, effectiveFrom, status: "ACTIVE" },
      }, tx);
      return assignment;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (uniqueViolation(error)) throw new AssignmentConflictError();
    throw error;
  }
}

export async function endDriverVehicleAssignment(input: { tenantId: string; assignmentId: string; actorUserId: string; effectiveTo?: Date; reason: string }) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.driverVehicleAssignment.findFirst({ where: { id: input.assignmentId, tenantId: input.tenantId } });
    if (!assignment) return null;
    if (assignment.status !== "ACTIVE" || assignment.effectiveTo) throw new AssignmentConflictError("This assignment has already ended.");
    const effectiveTo = input.effectiveTo ?? new Date();
    if (effectiveTo < assignment.effectiveFrom) throw new AssignmentChronologyError("The assignment end cannot precede its start.");
    const ended = await tx.driverVehicleAssignment.update({
      where: { id: assignment.id },
      data: { status: "ENDED", effectiveTo, endReason: input.reason, endedByUserId: input.actorUserId },
    });
    await tx.vehicle.updateMany({
      where: { id: assignment.vehicleId, tenantId: input.tenantId, assignedDriverId: assignment.driverId },
      data: { assignedDriverId: null },
    });
    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorUserId,
      action: "driverVehicleAssignment.ended",
      entityType: "DriverVehicleAssignment",
      entityId: assignment.id,
      reason: input.reason,
      afterValue: { effectiveTo, status: "ENDED" },
    }, tx);
    return ended;
  }, { isolationLevel: "Serializable" });
}
