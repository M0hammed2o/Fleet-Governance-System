import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { evaluatePolicyCompliance, type PolicyViolation } from "@/lib/telematics/geofence-engine";
import { computeDistanceSoFar } from "@/lib/telematics/distance-engine";
import { MockTelematicsProvider } from "@/lib/telematics/mock-provider";
import { DisabledTelematicsProvider, TelematicsProviderUnavailableError, type TelematicsProvider } from "@/lib/telematics/provider";
import type { Prisma } from "@/generated/prisma/client";
import { classifyTrackerFreshness } from "@/lib/telematics/integration-contract";

const localMockAllowed = ["development", "test"].includes(process.env.APP_ENV ?? "") ||
  (!process.env.APP_ENV && process.env.NODE_ENV !== "production");
const configuredSyntheticAllowed = process.env.TELEMATICS_PROVIDER === "synthetic" &&
  process.env.APP_ENV !== "production" && process.env.NODE_ENV !== "production";
const defaultProvider: TelematicsProvider =
  (localMockAllowed && (process.env.TELEMATICS_PROVIDER === "mock" || !process.env.TELEMATICS_PROVIDER)) || configuredSyntheticAllowed
    ? new MockTelematicsProvider()
    : new DisabledTelematicsProvider();

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
 * Pulls a current snapshot through the configured legacy-compatible provider
 * boundary for a vehicle with an active Phase 15 tracker mapping, records a
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

  const mapping = await prisma.trackerVehicleMapping.findFirst({
    where: { tenantId: input.tenantId, vehicleId: vehicle.id, effectiveFrom: { lte: new Date() }, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!mapping) {
    await recordAudit({ tenantId: input.tenantId, userId: input.actorUserId, action: "telematics.unmappedQuarantined", entityType: "Vehicle", entityId: vehicle.id, reason: "No active tracker mapping; no provider request was attempted." });
    throw new TelematicsProviderUnavailableError("Vehicle tracker data is quarantined because no active mapping exists.");
  }
  if (mapping.source === "SYNTHETIC" && (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production")) {
    throw new TelematicsProviderUnavailableError("Synthetic tracker mappings are forbidden in production.");
  }
  if (mapping.source === "LIVE_PROVIDER" && provider instanceof MockTelematicsProvider) {
    throw new TelematicsProviderUnavailableError("A synthetic provider cannot ingest data for a live-provider mapping.");
  }

  const providerVehicleId = mapping.providerAssetId;

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

  const receivedAt = new Date();
  const freshness = classifyTrackerFreshness(snapshot.lastCommunicationAt, receivedAt, STALE_THRESHOLD_MS);
  const isStale = freshness !== "FRESH";

  const updatedVehicle = await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      gpsStatus: isStale ? "INACTIVE" : "ACTIVE",
      gpsLastCommunicationAt: snapshot.lastCommunicationAt,
    },
  });

  let event = null;
  if (snapshot.position) {
    event = await prisma.telematicsEvent.upsert({
      where: { tenantId_providerId_providerEventId: { tenantId: input.tenantId, providerId: mapping.providerId, providerEventId: snapshot.providerReference } },
      create: {
        tenantId: input.tenantId,
        vehicleId: vehicle.id,
        source: mapping.source === "SYNTHETIC" ? "SYNTHETIC" : "PROVIDER",
        latitude: snapshot.position.latitude,
        longitude: snapshot.position.longitude,
        speedKmh: snapshot.position.speedKmh,
        headingDegrees: snapshot.position.headingDegrees,
        ignitionOn: snapshot.ignitionOn,
        odometerKm: snapshot.odometerKm,
        recordedAt: snapshot.position.recordedAt,
        providerReference: snapshot.providerReference,
        trackerMappingId: mapping.id,
        providerId: mapping.providerId,
        providerEventId: snapshot.providerReference,
        collectionMethod: mapping.source === "SYNTHETIC" ? "SIMULATOR" : "POLLING",
        receivedAt,
        normalizedAt: receivedAt,
        freshness,
        mappingState: "MAPPED",
        processingStatus: "ACCEPTED",
        correctionStatus: "ORIGINAL",
        confidenceLimitations: mapping.source === "SYNTHETIC" ? "Synthetic test data; not observed from a real vehicle." : "Location accuracy was not supplied by the provider contract version used for this event.",
        isSynthetic: mapping.source === "SYNTHETIC",
      },
      update: {},
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

// Wide enough to always contain a full calendar month plus the trip/week
// lookback the distance engine needs, regardless of which day of the month
// `at` falls on.
const DISTANCE_LOOKBACK_DAYS = 45;

// A violation re-observed on this many consecutive syncs is escalated to
// HIGH/supervisor-approval even if it started out MEDIUM — a violation that
// keeps recurring deserves escalated review, not indefinite silent
// repetition at its original severity (Phase 8A "escalate continuing
// violations appropriately"). Count-based, not time-based, so it's
// deterministic to test without mocking elapsed time.
const ESCALATION_OBSERVATION_THRESHOLD = 3;

/**
 * GPS-exception deduplication (Phase 8A): reconciles the violation types
 * detected on *this* sync against any already-OPEN telematics exceptions
 * for the vehicle (`Exception.violationType` set, `resolvedAt: null`) —
 * never raises a second open exception for a violation type that's already
 * an open episode, tracks how many consecutive syncs have re-observed it
 * (escalating severity/supervisor-approval once it persists), and
 * automatically clears any open episode whose violation type is no longer
 * present in this sync's results (the vehicle has returned to compliance
 * for that specific rule). A gate-event/reconciliation exception (created
 * elsewhere, `violationType: null`) is never touched by this function.
 */
async function reconcileTelematicsViolations(
  tenantId: string,
  vehicleId: string,
  violations: PolicyViolation[],
  actorUserId: string,
  observedAt: Date,
): Promise<PolicyViolation[]> {
  const openEpisodes = await prisma.exception.findMany({
    where: { tenantId, vehicleId, resolvedAt: null, violationType: { not: null } },
  });
  const stillActiveTypes = new Set(violations.map((v) => v.type as string));

  for (const episode of openEpisodes) {
    if (episode.violationType && !stillActiveTypes.has(episode.violationType)) {
      await prisma.exception.update({
        where: { id: episode.id },
        data: {
          resolvedAt: observedAt,
          resolutionNotes: "Automatically cleared — vehicle telemetry showed compliance with this rule on a subsequent sync.",
        },
      });
      await recordAudit({
        tenantId,
        userId: actorUserId,
        action: "telematics.policyViolationCleared",
        entityType: "Exception",
        entityId: episode.id,
        beforeValue: { violationType: episode.violationType, severity: episode.severity },
      });
    }
  }

  for (const violation of violations) {
    const episode = openEpisodes.find((e) => e.violationType === violation.type);
    if (episode) {
      const observationCount = episode.observationCount + 1;
      const shouldEscalate =
        observationCount >= ESCALATION_OBSERVATION_THRESHOLD && episode.severity !== "HIGH" && episode.severity !== "CRITICAL";
      await prisma.exception.update({
        where: { id: episode.id },
        data: {
          lastObservedAt: observedAt,
          observationCount,
          ...(shouldEscalate ? { severity: "HIGH" as const, requiresSupervisorApproval: true } : {}),
        },
      });
      if (shouldEscalate) {
        await recordAudit({
          tenantId,
          userId: actorUserId,
          action: "telematics.policyViolationEscalated",
          entityType: "Exception",
          entityId: episode.id,
          beforeValue: { severity: episode.severity },
          afterValue: { severity: "HIGH", observationCount },
        });
      }
    } else {
      const exception = await prisma.exception.create({
        data: {
          tenantId,
          vehicleId,
          description: violation.description,
          severity: violation.severity,
          requiresSupervisorApproval: violation.severity === "HIGH",
          raisedByUserId: actorUserId,
          violationType: violation.type,
          observationCount: 1,
          lastObservedAt: observedAt,
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
  }

  return violations;
}

/**
 * GPS-004/POLICY-002: compares one TelematicsEvent against the vehicle's
 * currently ACTIVE VehicleUsePolicy (if any) and reconciles the result
 * against any already-open telematics exceptions (see
 * `reconcileTelematicsViolations()` above — Phase 8A deduplication) rather
 * than raising a fresh Exception on every sync. Never concludes
 * fraud/theft — see lib/telematics/geofence-engine.ts's own docs.
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

  let violations: PolicyViolation[] = [];

  if (assignment) {
    const policy = assignment.policy;
    const withinEffectiveWindow = (!policy.effectiveTo || policy.effectiveTo >= event.recordedAt) && policy.effectiveFrom <= event.recordedAt;

    if (withinEffectiveWindow) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
      const timezone = tenant?.timezone ?? "Africa/Johannesburg";

      const lookbackStart = new Date(event.recordedAt.getTime() - DISTANCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const readings = await prisma.telematicsEvent.findMany({
        where: { tenantId, vehicleId, recordedAt: { gte: lookbackStart, lte: event.recordedAt } },
        orderBy: { recordedAt: "asc" },
        select: { recordedAt: true, odometerKm: true, ignitionOn: true },
      });
      const distanceSoFar = computeDistanceSoFar({ readings, at: event.recordedAt, timezone });

      violations = evaluatePolicyCompliance({
        position: event.latitude != null && event.longitude != null ? { latitude: event.latitude, longitude: event.longitude } : null,
        at: event.recordedAt,
        timezone,
        policy: {
          permittedDaysOfWeek: policy.permittedDaysOfWeek,
          permittedStartTime: policy.permittedStartTime,
          permittedEndTime: policy.permittedEndTime,
          allowAfterHours: policy.allowAfterHours,
          allowWeekend: policy.allowWeekend,
          approvedGeofence: policy.approvedGeofence,
          kmLimitPerTrip: policy.kmLimitPerTrip,
          kmLimitPerDay: policy.kmLimitPerDay,
          kmLimitPerWeek: policy.kmLimitPerWeek,
          kmLimitPerMonth: policy.kmLimitPerMonth,
        },
        distanceSoFar,
      });
    }
  }

  // Always reconciled, even with an empty violations list — that's exactly
  // what auto-clears any previously-open episode when the vehicle no longer
  // has an active/effective policy at all (compliance is trivially true
  // when there's nothing left to violate).
  return reconcileTelematicsViolations(tenantId, vehicleId, violations, actorUserId, event.recordedAt);
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

  // P11-000 (DECISIONS.md D-038): vehicle links are created via a separate,
  // explicit createMany() rather than a nested `vehicles: { create: [...] }`
  // write — see the same pattern's rationale in invoice-repository.ts.
  const policy = await prisma.$transaction(async (tx) => {
    const created = await tx.vehicleUsePolicy.create({
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
      },
    });
    await tx.vehicleUsePolicyVehicle.createMany({
      data: input.vehicleIds.map((vehicleId) => ({ policyId: created.id, vehicleId })),
    });
    return tx.vehicleUsePolicy.findUniqueOrThrow({
      where: { id: created.id },
      include: { vehicles: { include: { vehicle: true } }, driver: true, approvedGeofence: true },
    });
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
