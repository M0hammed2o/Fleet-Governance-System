import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { assertValidMovementTransition, type MovementStatus } from "@/lib/movements/state-machine";
import { generateMovementReferenceCode } from "@/lib/movements/reference-code";
import { isDriverAvailableForMovement } from "@/lib/repositories/driver-repository";
import { isVehicleAvailableForMovement } from "@/lib/repositories/vehicle-repository";
import type { MovementType, Prisma } from "@/generated/prisma/client";

export class SelfApprovalNotAllowedError extends Error {
  constructor() {
    super("This company's policy does not allow approving your own movement request.");
    this.name = "SelfApprovalNotAllowedError";
  }
}

export class DriverNotAvailableError extends Error {
  constructor(status: string) {
    super(`Driver is not available for a normal movement (status: ${status}).`);
    this.name = "DriverNotAvailableError";
  }
}

export class VehicleNotAvailableError extends Error {
  constructor(status: string) {
    super(`Vehicle is not available for a normal movement (status: ${status}).`);
    this.name = "VehicleNotAvailableError";
  }
}

export interface ListMovementsOptions {
  status?: MovementStatus;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function listMovementsInTenant(tenantId: string, options: ListMovementsOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));

  const where = tenantWhere(tenantId, options.status ? { status: options.status } : {});

  const [items, total] = await Promise.all([
    prisma.movementAuthorisation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { vehicle: true, driver: true, requester: true, approver: true },
    }),
    prisma.movementAuthorisation.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getMovementInTenant(tenantId: string, movementId: string) {
  return prisma.movementAuthorisation.findFirst({
    where: tenantWhere(tenantId, { id: movementId }),
    include: { vehicle: true, driver: true, trailerVehicle: true, site: true, requester: true, approver: true },
  });
}

export interface CreateMovementInput {
  tenantId: string;
  siteId: string;
  vehicleId: string;
  driverId: string;
  trailerVehicleId?: string | null;
  movementType: MovementType;
  purpose?: string | null;
  destination?: string | null;
  expectedDepartureAt?: Date | null;
  expectedReturnAt?: Date | null;
  customerProjectJobReference?: string | null;
  deliveryOrCollectionReference?: string | null;
  purchaseOrderReference?: string | null;
  approvedCargoSummary?: string | null;
  sealOrContainerReference?: string | null;
  requesterUserId: string;
}

/**
 * A suspended/blacklisted driver or a non-operational vehicle cannot be
 * selected for a normal movement request — enforced here (not just in the
 * route) so every caller gets the same guarantee, and so it's testable
 * without needing an HTTP request. Caller must have already confirmed
 * driverId/vehicleId belong to this tenant (see /api/movements POST).
 */
export async function createMovement(input: CreateMovementInput) {
  const [driver, vehicle] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id: input.driverId } }),
    prisma.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } }),
  ]);
  if (!isDriverAvailableForMovement(driver)) throw new DriverNotAvailableError(driver.status);
  if (!isVehicleAvailableForMovement(vehicle)) throw new VehicleNotAvailableError(vehicle.operationalStatus);

  let referenceCode = generateMovementReferenceCode();
  // Extremely unlikely collision (6 chars, 32-symbol alphabet ≈ 1 billion
  // combinations) but the column is unique, so retry rather than trust luck blindly.
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.movementAuthorisation.findUnique({ where: { referenceCode } });
    if (!existing) break;
    referenceCode = generateMovementReferenceCode();
  }

  return prisma.movementAuthorisation.create({
    data: { ...input, referenceCode, status: "DRAFT" },
  });
}

async function transition(
  tenantId: string,
  movementId: string,
  to: MovementStatus,
  actorUserId: string,
  auditAction: string,
  extra?: Prisma.MovementAuthorisationUpdateInput,
) {
  const movement = await prisma.movementAuthorisation.findFirst({ where: tenantWhere(tenantId, { id: movementId }) });
  if (!movement) return null;

  assertValidMovementTransition(movement.status as MovementStatus, to);

  const updated = await prisma.movementAuthorisation.update({
    where: { id: movementId },
    data: { status: to, ...extra },
  });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: auditAction,
    entityType: "MovementAuthorisation",
    entityId: movementId,
    beforeValue: { status: movement.status },
    afterValue: { status: to },
  });

  return updated;
}

export async function submitMovement(tenantId: string, movementId: string, actorUserId: string) {
  return transition(tenantId, movementId, "SUBMITTED", actorUserId, "movement.submitted");
}

export interface ApproveMovementInput {
  tenantId: string;
  movementId: string;
  approverUserId: string;
  comments?: string | null;
}

/**
 * Enforces the self-approval rule: a user cannot approve their own request
 * unless the tenant has explicitly opted into allowing it
 * (Tenant.allowSelfApproveMovement — default false). Build brief 7.5/7.7.
 */
export async function approveMovement(input: ApproveMovementInput) {
  const movement = await prisma.movementAuthorisation.findFirst({
    where: tenantWhere(input.tenantId, { id: input.movementId }),
  });
  if (!movement) return null;

  if (movement.requesterUserId === input.approverUserId) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
    if (!tenant.allowSelfApproveMovement) {
      throw new SelfApprovalNotAllowedError();
    }
  }

  return transition(input.tenantId, input.movementId, "APPROVED", input.approverUserId, "movement.approved", {
    approver: { connect: { id: input.approverUserId } },
    approvalComments: input.comments ?? null,
  });
}

export async function rejectMovement(input: ApproveMovementInput) {
  return transition(input.tenantId, input.movementId, "REJECTED", input.approverUserId, "movement.rejected", {
    approver: { connect: { id: input.approverUserId } },
    approvalComments: input.comments ?? null,
  });
}

export async function cancelMovement(tenantId: string, movementId: string, actorUserId: string, reason?: string | null) {
  return transition(tenantId, movementId, "CANCELLED", actorUserId, "movement.cancelled", {
    cancelledAt: new Date(),
    cancelledReason: reason ?? null,
  });
}

export async function expireMovement(tenantId: string, movementId: string, actorUserId: string) {
  return transition(tenantId, movementId, "EXPIRED", actorUserId, "movement.expired");
}

export async function startMovement(tenantId: string, movementId: string, actorUserId: string) {
  return transition(tenantId, movementId, "IN_PROGRESS", actorUserId, "movement.started");
}

export async function completeMovement(tenantId: string, movementId: string, actorUserId: string) {
  return transition(tenantId, movementId, "COMPLETED", actorUserId, "movement.completed");
}

/**
 * Gate-facing lookup (build brief 7.5 "gate-facing lookup"): find the
 * already-approved movement a security officer needs, by any of the
 * identifiers they'd plausibly have on hand. Read-only by construction — this
 * file has no function that lets a gate-facing caller edit the record, only
 * find and view it. Restricted to non-draft records: a DRAFT hasn't been
 * submitted yet and shouldn't be discoverable at the gate.
 */
export async function searchMovementsForGate(tenantId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.movementAuthorisation.findMany({
    where: tenantWhere(tenantId, {
      status: { not: "DRAFT" },
      OR: [
        { referenceCode: { contains: trimmed, mode: "insensitive" } },
        { deliveryOrCollectionReference: { contains: trimmed, mode: "insensitive" } },
        { purchaseOrderReference: { contains: trimmed, mode: "insensitive" } },
        { vehicle: { registrationNumber: { contains: trimmed, mode: "insensitive" } } },
        { vehicle: { fleetNumber: { contains: trimmed, mode: "insensitive" } } },
        { driver: { name: { contains: trimmed, mode: "insensitive" } } },
      ],
    } satisfies Prisma.MovementAuthorisationWhereInput),
    orderBy: { expectedDepartureAt: "asc" },
    take: 25,
    include: { vehicle: true, driver: true, trailerVehicle: true, site: true },
  });
}
