import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { evaluatePolicyCompliance, type PolicyViolation } from "@/lib/telematics/geofence-engine";
import { MockTelematicsProvider } from "@/lib/telematics/mock-provider";
import { TelematicsProviderUnavailableError, type TelematicsProvider } from "@/lib/telematics/provider";
import type { Prisma } from "@/generated/prisma/client";

const defaultProvider: TelematicsProvider = new MockTelematicsProvider();

// A snapshot older than this is never trusted as "current" — flagged stale
// instead (GPS-006 "stale data is flagged, not silently trusted"), and
// geofence/policy compliance is not evaluated against it (an unreliable
// position must not generate a false violation).
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found.");
    this.name = "VehicleNotFoundError";
  }
}
export class SelfApprovalNotAllowedError extends Error {
  constructor() {
    super("A user cannot resolve their own manual GPS confirmation request.");
    this.name = "SelfApprovalNotAllowedError";
  }
}
export class GeofenceNotFoundError extends Error {
  constructor() {
    super("Geofence not found.");
    this.name = "GeofenceNotFoundError";
  }
}
export class DriverNotFoundError extends Error {
  constructor() {
    super("Driver not found.");
    this.name = "DriverNotFoundError";
  }
}
export class NotTheApprovingManagerError extends Error {
  constructor() {
    super("Only the named approving manager can approve this vehicle-use policy.");
    this.name = "NotTheApprovingManagerError";
  }
}
export class PolicyNotDraftError extends Error {
  constructor() {
    super("Only a DRAFT vehicle-use policy can be approved.");
    this.name = "PolicyNotDraftError";
  }
}

// --- GPS-003: vehicle-to-tracker sync ---------------------------------------

export interface SyncVehicleTelematicsInput {
  tenantId: string;
  vehicleId: string;
  actorUserId: string;
}

export interface SyncVehicleTelematicsResult {
  vehicle: Awaited<ReturnType<typeof prisma.vehicle.update>>;
  event: Awaited<ReturnType<typeof prisma.telematicsEvent.create>> | null;
  isStale: boolean;
  violations: PolicyViolation[];
}

/**
 * Pulls a current snapshot from the (mock) provider for a vehicle that
 * already has `gpsDeviceReference` configured (GPS-003's tracker mapping —
 * already possible via the existing Phase 2 `updateVehicle`), records a
 * TelematicsEvent, updates `Vehicle.gpsStatus`/`gpsLastCommunicationAt`, and
 * — if the reading isn't stale — evaluates it against the vehicle's active
 * VehicleUsePolicy (GPS-004/POLICY-002).
 */
export async function syncVehicleTelematics(
  input: SyncVehicleTelematicsInput,
  provider: TelematicsProvider = defaultProvider,
): Promise<SyncVehicleTelematicsResult> {
  const vehicle = await prisma.vehicle.findFirst({ where: tenantWhere(input.tenantId, { id: input.vehicleId }) });
  if (!vehicle) throw new VehicleNotFoundError();

  const providerVehicleId = vehicle.gpsDeviceReference ?? vehicle.id;

  let snapshot;
  try {
    snapshot = await provider.getSnapshot(providerVehicleId);
  } catch (err) {
    if (err instanceof TelematicsProviderUnavailableError) {
      await prisma.vehicle.update({ where: { id: vehicle.id }, data: { gpsStatus: "INACTIVE" } });
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorUserId,
        action: "telematics.syncFailed",
        entityType: "Vehicle",
        entityId: vehicle.id,
        reason: err.message,
      });
    }
    throw err;
  }

  const isStale =
    !snapshot.lastCommunicationAt || Date.now() - snapshot.lastCommunicationAt.getTime() > STALE_THRESHOLD_MS;

  const updatedVehicle = await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      gpsStatus: isStale ? "INACTIVE" : "ACTIVE",
      gpsLastCommunicationAt: snapshot.lastCommunicationAt,
    },
  });

  let event = null;
  if (snapshot.position) {
    event = await prisma.telematicsEvent.create({
      data: {
        tenantId: input.tenantId,
        vehicleId: vehicle.id,
        source: "PROVIDER",
        latitude: snapshot.position.latitude,
        longitude: snapshot.position.longitude,
        speedKmh: snapshot.position.speedKmh,
        headingDegrees: snapshot.position.headingDegrees,
        ignitionOn: snapshot.ignitionOn,
        odometerKm: snapshot.odometerKm,
        recordedAt: snapshot.position.recordedAt,
        providerReference: snapshot.providerReference,
      },
    });
  }

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "telematics.synced",
    entityType: "Vehicle",
    entityId: vehicle.id,
    afterValue: { gpsStatus: updatedVehicle.gpsStatus, isStale, hasPosition: Boolean(snapshot.position) },
  });

  let violations: PolicyViolation[] = [];
  if (event && !isStale) {
    violations = await evaluateVehiclePolicyCompliance(input.tenantId, vehicle.id, event, input.actorUserId);
  }

  return { vehicle: updatedVehicle, event, isStale, violations };
}

/**
 * GPS-004/POLICY-002: compares one TelematicsEvent against the vehicle's
 * currently ACTIVE VehicleUsePolicy (if any) and raises a real Exception
 * (vehicleId-linked, no GateEvent involved — see DECISIONS.md D-020) for
 * each violation found. Never concludes fraud/theft — see
 * lib/telematics/geofence-engine.ts's own docs.
 */
export async function evaluateVehiclePolicyCompliance(
  tenantId: string,
  vehicleId: string,
  event: { latitude: number | null; longitude: number | null; recordedAt: Date },
  actorUserId: string,
): Promise<PolicyViolation[]> {
  const assignment = await prisma.vehicleUsePolicyVehicle.findFirst({
    where: { vehicleId, policy: { tenantId, status: "ACTIVE" } },
    include: { policy: { include: { approvedGeofence: true } } },
  });
  if (!assignment) return [];

  const policy = assignment.policy;
  if (policy.effectiveTo && policy.effectiveTo < event.recordedAt) return [];
  if (policy.effectiveFrom > event.recordedAt) return [];

  const violations = evaluatePolicyCompliance({
    position: event.latitude != null && event.longitude != null ? { latitude: event.latitude, longitude: event.longitude } : null,
    at: event.recordedAt,
    policy: {
      permittedDaysOfWeek: policy.permittedDaysOfWeek,
      permittedStartTime: policy.permittedStartTime,
      permittedEndTime: policy.permittedEndTime,
      allowAfterHours: policy.allowAfterHours,
      allowWeekend: policy.allowWeekend,
      approvedGeofence: policy.approvedGeofence,
      kmLimitPerTrip: policy.kmLimitPerTrip,
    },
    // Real per-trip distance accumulation isn't wired up in this phase (no
    // trip-boundary tracking yet) — per-trip km-limit violations simply don't
    // fire rather than being silently guessed at.
    tripKmSoFar: null,
  });

  for (const violation of violations) {
    const exception = await prisma.exception.create({
      data: {
        tenantId,
        vehicleId,
        description: violation.description,
        severity: violation.severity,
        requiresSupervisorApproval: violation.severity === "HIGH",
        raisedByUserId: actorUserId,
      },
    });
    await recordAudit({
      tenantId,
      userId: actorUserId,
      action: "telematics.policyViolationRaised",
      entityType: "Exception",
      entityId: exception.id,
      afterValue: { type: violation.type, severity: violation.severity },
    });
  }

  return violations;
}

// --- GPS-002: manual GPS confirmation (mirrors ManualFacialVerificationFallback exactly) ---

export interface RequestManualGpsConfirmationInput {
  tenantId: string;
  vehicleId: string;
  requestedByUserId: string;
  reason: string;
  positionDescription: string;
}

export async function requestManualGpsConfirmation(input: RequestManualGpsConfirmationInput) {
  const vehicle = await prisma.vehicle.findFirst({ where: tenantWhere(input.tenantId, { id: input.vehicleId }) });
  if (!vehicle) throw new VehicleNotFoundError();

  const confirmation = await prisma.manualGpsConfirmation.create({
    data: {
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
      requestedByUserId: input.requestedByUserId,
      reason: input.reason,
      positionDescription: input.positionDescription,
      status: "PENDING",
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.requestedByUserId,
    action: "telematics.manualGpsConfirmation.requested",
    entityType: "ManualGpsConfirmation",
    entityId: confirmation.id,
    reason: input.reason,
  });

  return confirmation;
}

export interface ResolveManualGpsConfirmationInput {
  tenantId: string;
  confirmationId: string;
  approvedByUserId: string;
  decision: "APPROVED" | "DENIED";
}

/** Hard, unconditional self-approval rule — same as facial-verification's equivalent. */
export async function resolveManualGpsConfirmation(input: ResolveManualGpsConfirmationInput) {
  const confirmation = await prisma.manualGpsConfirmation.findFirst({
    where: tenantWhere(input.tenantId, { id: input.confirmationId }),
  });
  if (!confirmation) return null;
  if (confirmation.requestedByUserId === input.approvedByUserId) throw new SelfApprovalNotAllowedError();
  if (confirmation.status !== "PENDING") return confirmation;

  const updated = await prisma.manualGpsConfirmation.update({
    where: { id: confirmation.id },
    data: { status: input.decision, approvedByUserId: input.approvedByUserId, resolvedAt: new Date() },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.approvedByUserId,
    action: `telematics.manualGpsConfirmation.${input.decision === "APPROVED" ? "approved" : "denied"}`,
    entityType: "ManualGpsConfirmation",
    entityId: confirmation.id,
    beforeValue: { status: "PENDING" },
    afterValue: { status: input.decision },
  });

  return updated;
}

// --- Geofences ---------------------------------------------------------------

export interface CreateGeofenceInput {
  tenantId: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
}

export async function createGeofence(input: CreateGeofenceInput) {
  return prisma.geofence.create({ data: input });
}

export async function listGeofencesInTenant(tenantId: string) {
  return prisma.geofence.findMany({ where: tenantWhere(tenantId), orderBy: { name: "asc" } });
}

// --- POLICY-001: VehicleUsePolicy CRUD + approval ----------------------------

export interface CreateVehicleUsePolicyInput {
  tenantId: string;
  name: string;
  driverId: string;
  vehicleIds: string[];
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  permittedDaysOfWeek?: number[];
  permittedStartTime?: string | null;
  permittedEndTime?: string | null;
  approvedDestination?: string | null;
  approvedGeofenceId?: string | null;
  kmLimitPerTrip?: number | null;
  kmLimitPerDay?: number | null;
  kmLimitPerWeek?: number | null;
  kmLimitPerMonth?: number | null;
  allowAfterHours?: boolean;
  allowWeekend?: boolean;
  allowPrivateUse?: boolean;
  privateUseKmAllowanceKm?: number | null;
  expectedReturnTime?: string | null;
  approvingManagerUserId?: string | null;
}

export async function createVehicleUsePolicy(input: CreateVehicleUsePolicyInput) {
  const driver = await prisma.driver.findFirst({ where: tenantWhere(input.tenantId, { id: input.driverId }) });
  if (!driver) throw new DriverNotFoundError();

  const vehicles = await prisma.vehicle.findMany({ where: tenantWhere(input.tenantId, { id: { in: input.vehicleIds } } satisfies Prisma.VehicleWhereInput) });
  if (vehicles.length !== input.vehicleIds.length) throw new VehicleNotFoundError();

  if (input.approvedGeofenceId) {
    const geofence = await prisma.geofence.findFirst({ where: tenantWhere(input.tenantId, { id: input.approvedGeofenceId }) });
    if (!geofence) throw new GeofenceNotFoundError();
  }

  const policy = await prisma.vehicleUsePolicy.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      driverId: input.driverId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      permittedDaysOfWeek: input.permittedDaysOfWeek ?? [],
      permittedStartTime: input.permittedStartTime ?? null,
      permittedEndTime: input.permittedEndTime ?? null,
      approvedDestination: input.approvedDestination ?? null,
      approvedGeofenceId: input.approvedGeofenceId ?? null,
      kmLimitPerTrip: input.kmLimitPerTrip ?? null,
      kmLimitPerDay: input.kmLimitPerDay ?? null,
      kmLimitPerWeek: input.kmLimitPerWeek ?? null,
      kmLimitPerMonth: input.kmLimitPerMonth ?? null,
      allowAfterHours: input.allowAfterHours ?? false,
      allowWeekend: input.allowWeekend ?? false,
      allowPrivateUse: input.allowPrivateUse ?? false,
      privateUseKmAllowanceKm: input.privateUseKmAllowanceKm ?? null,
      expectedReturnTime: input.expectedReturnTime ?? null,
      approvingManagerUserId: input.approvingManagerUserId ?? null,
      status: "DRAFT",
      vehicles: { create: input.vehicleIds.map((vehicleId) => ({ vehicleId })) },
    },
    include: { vehicles: { include: { vehicle: true } }, driver: true, approvedGeofence: true },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.approvingManagerUserId ?? null,
    action: "vehicleUsePolicy.created",
    entityType: "VehicleUsePolicy",
    entityId: policy.id,
    afterValue: { name: policy.name, driverId: policy.driverId, vehicleIds: input.vehicleIds },
  });

  return policy;
}

/** Only the named approving manager can move DRAFT -> ACTIVE (POLICY-001). */
export async function approveVehicleUsePolicy(tenantId: string, policyId: string, actorUserId: string) {
  const policy = await prisma.vehicleUsePolicy.findFirst({ where: tenantWhere(tenantId, { id: policyId }) });
  if (!policy) return null;
  if (policy.status !== "DRAFT") throw new PolicyNotDraftError();
  if (policy.approvingManagerUserId && policy.approvingManagerUserId !== actorUserId) {
    throw new NotTheApprovingManagerError();
  }

  const updated = await prisma.vehicleUsePolicy.update({
    where: { id: policy.id },
    data: { status: "ACTIVE", approvingManagerUserId: actorUserId },
  });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "vehicleUsePolicy.approved",
    entityType: "VehicleUsePolicy",
    entityId: policy.id,
    beforeValue: { status: "DRAFT" },
    afterValue: { status: "ACTIVE" },
  });

  return updated;
}

export async function listVehicleUsePoliciesInTenant(tenantId: string) {
  return prisma.vehicleUsePolicy.findMany({
    where: tenantWhere(tenantId),
    orderBy: { createdAt: "desc" },
    include: { driver: true, vehicles: { include: { vehicle: true } }, approvingManager: true },
  });
}

export async function getVehicleUsePolicyInTenant(tenantId: string, policyId: string) {
  return prisma.vehicleUsePolicy.findFirst({
    where: tenantWhere(tenantId, { id: policyId }),
    include: { driver: true, vehicles: { include: { vehicle: true } }, approvingManager: true, approvedGeofence: true },
  });
}
