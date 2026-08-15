import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import {
  assertValidGateEventTransition,
  isValidGateEventTransition,
  type GateEventStatus,
} from "@/lib/gate-events/state-machine";
import { isDriverAvailableForMovement } from "@/lib/repositories/driver-repository";
import { isVehicleAvailableForMovement } from "@/lib/repositories/vehicle-repository";
import { getActiveTemplateForCategory } from "@/lib/repositories/inspection-template-repository";
import { startMovement, completeMovement } from "@/lib/repositories/movement-repository";
import { buildReconciliation, ReconciliationNotReadyError } from "@/lib/repositories/reconciliation-repository";
import type { FacialVerificationProvider } from "@/lib/facial-verification/provider";
import { MockFacialVerificationProvider } from "@/lib/facial-verification/mock-provider";
import { getActiveTemplateDescriptorForDriver } from "@/lib/repositories/facial-enrolment-repository";
import { evaluateMatch, DEFAULT_MATCH_THRESHOLD, DEFAULT_REVIEW_THRESHOLD } from "@/lib/facial-verification/descriptor-math";
import {
  DeterministicBiometricSimulator,
  type BiometricSimulatorScenario,
} from "@/lib/facial-verification/simulator";
import { SYNTHETIC_BIOMETRIC_LABEL } from "@/lib/facial-verification/contracts";
import { logger } from "@/lib/observability/logger";
import type {
  GateEventDirection,
  InspectionOutcome,
  ExceptionSeverity,
  ExceptionOutcomeAction,
  FacialVerificationResultType,
  LivenessChallengeResult,
  Prisma,
} from "@/generated/prisma/client";

const defaultProvider: FacialVerificationProvider = new MockFacialVerificationProvider();

export class MovementNotApprovedError extends Error {
  constructor(status: string) {
    super(`Movement authorisation is not APPROVED (current status: ${status}) — cannot start a gate event.`);
    this.name = "MovementNotApprovedError";
  }
}
export class DriverNotAvailableError extends Error {
  constructor(status: string) {
    super(`Driver is not available at the gate (status: ${status}).`);
    this.name = "DriverNotAvailableError";
  }
}
export class VehicleNotAvailableError extends Error {
  constructor(status: string) {
    super(`Vehicle is not available for a normal clearance (status: ${status}).`);
    this.name = "VehicleNotAvailableError";
  }
}
export class SelfApprovalNotAllowedError extends Error {
  constructor() {
    super("A security officer cannot resolve their own serious exception. This is a hard rule and is not tenant-configurable.");
    this.name = "SelfApprovalNotAllowedError";
  }
}
export class ExceptionAlreadyResolvedError extends Error {
  constructor() {
    super("This exception has already been resolved.");
    this.name = "ExceptionAlreadyResolvedError";
  }
}
export class ExceptionNotEscalatedError extends Error {
  constructor() {
    super("This exception requires supervisor approval and must be escalated (moved to SUPERVISOR_REVIEW) before it can be resolved.");
    this.name = "ExceptionNotEscalatedError";
  }
}
/**
 * A precondition-on-current-status violation that isn't a raw state-machine
 * transition (those go through assertValidGateEventTransition /
 * InvalidGateEventTransitionError) — e.g. "must be IDENTITY_PENDING to
 * attempt verification". Maps to 409 in every calling route, same as
 * InvalidGateEventTransitionError. A real bug was found and fixed here: these
 * five sites originally threw a plain `Error`, which every route's catch
 * block let fall through to a generic 500 instead of a meaningful 409/404.
 */
export class GateEventPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateEventPreconditionError";
  }
}
export class TooManyVerificationAttemptsError extends Error {
  constructor(limit: number, windowMinutes: number) {
    super(`Too many facial-verification attempts (${limit}) for this gate event in the last ${windowMinutes} minute(s) — escalate to a supervisor for manual fallback.`);
    this.name = "TooManyVerificationAttemptsError";
  }
}
export class ManualFallbackNotApprovedError extends Error {
  constructor() {
    super("Manual facial-verification fallback must be an APPROVED request in this tenant.");
    this.name = "ManualFallbackNotApprovedError";
  }
}
export class InspectionItemNotFoundError extends Error {
  constructor() {
    super("Inspection item not found for this gate event's template.");
    this.name = "InspectionItemNotFoundError";
  }
}
export class EvidenceMediaAssetNotFoundError extends Error {
  constructor() {
    super("The referenced evidence media asset was not found for this gate event.");
    this.name = "EvidenceMediaAssetNotFoundError";
  }
}
/**
 * `Exception.gateEventId` became nullable in Phase 6 (a telematics/policy
 * exception has no GateEvent — see DECISIONS.md D-020) — `resolveException()`
 * below is specifically the gate-tied resolution workflow (escalation,
 * self-approval, GateEvent state transition), so it rejects an exception
 * that isn't actually attached to a gate event rather than resolving it
 * incorrectly. Telematics exceptions resolve through
 * `telematics-repository.ts`'s own path instead.
 */
export class NotAGateEventExceptionError extends Error {
  constructor() {
    super("This exception is not attached to a gate event and cannot be resolved through the gate workflow.");
    this.name = "NotAGateEventExceptionError";
  }
}

// --- Core state transition helper, mirrors movement-repository.ts's `transition` ---

async function transitionGateEvent(
  tenantId: string,
  gateEventId: string,
  to: GateEventStatus,
  actorUserId: string,
  auditAction: string,
  extra?: Prisma.GateEventUncheckedUpdateInput,
) {
  const gateEvent = await prisma.gateEvent.findFirst({ where: tenantWhere(tenantId, { id: gateEventId }) });
  if (!gateEvent) return null;

  assertValidGateEventTransition(gateEvent.status as GateEventStatus, to);

  const updated = await prisma.gateEvent.update({
    where: { id: gateEventId },
    data: { status: to, ...extra },
  });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: auditAction,
    entityType: "GateEvent",
    entityId: gateEventId,
    relatedGateEventId: gateEventId,
    beforeValue: { status: gateEvent.status },
    afterValue: { status: to },
  });

  return updated;
}

// --- Starting a gate event -------------------------------------------------

export interface StartGateEventInput {
  tenantId: string;
  movementAuthorisationId: string;
  gateId: string;
  direction: GateEventDirection;
  securityOfficerUserId: string;
}

/**
 * Idempotent by construction: if a non-terminal GateEvent already exists for
 * this movement, it is returned unchanged rather than creating a second one —
 * satisfies "duplicate submissions do not create duplicate gate events"
 * (TESTING.md mandatory gate).
 */
export async function findOpenGateEventForMovement(tenantId: string, movementAuthorisationId: string) {
  return prisma.gateEvent.findFirst({
    where: tenantWhere(tenantId, {
      movementAuthorisationId,
      status: { notIn: ["CANCELLED", "COMPLETED"] },
    } satisfies Prisma.GateEventWhereInput),
    orderBy: { createdAt: "desc" },
  });
}

export async function startGateEvent(input: StartGateEventInput) {
  const existing = await findOpenGateEventForMovement(input.tenantId, input.movementAuthorisationId);
  if (existing) return existing;

  const movement = await prisma.movementAuthorisation.findFirst({
    where: tenantWhere(input.tenantId, { id: input.movementAuthorisationId }),
  });
  if (!movement) return null;
  if (movement.status !== "APPROVED") throw new MovementNotApprovedError(movement.status);

  const [driver, vehicle] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id: movement.driverId } }),
    prisma.vehicle.findUniqueOrThrow({ where: { id: movement.vehicleId } }),
  ]);
  if (!isDriverAvailableForMovement(driver)) throw new DriverNotAvailableError(driver.status);
  if (!isVehicleAvailableForMovement(vehicle)) throw new VehicleNotAvailableError(vehicle.operationalStatus);

  const template = await getActiveTemplateForCategory(input.tenantId, vehicle.category);

  const gateEvent = await prisma.gateEvent.create({
    data: {
      tenantId: input.tenantId,
      siteId: movement.siteId,
      gateId: input.gateId,
      direction: input.direction,
      vehicleId: movement.vehicleId,
      trailerVehicleId: movement.trailerVehicleId,
      driverId: movement.driverId,
      movementAuthorisationId: movement.id,
      securityOfficerUserId: input.securityOfficerUserId,
      inspectionTemplateId: template?.id ?? null,
      status: "EXPECTED",
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.securityOfficerUserId,
    action: "gateEvent.started",
    entityType: "GateEvent",
    entityId: gateEvent.id,
    afterValue: { movementAuthorisationId: movement.id, direction: input.direction, gateId: input.gateId },
  });

  // Move straight into INSPECTION_STARTED — from the officer's perspective
  // "start the gate event" and "begin the inspection" are the same tap
  // (build brief: this should feel like one connected flow, not disconnected
  // steps). Both transitions are still individually recorded and audited.
  const started = await transitionGateEvent(
    input.tenantId,
    gateEvent.id,
    "INSPECTION_STARTED",
    input.securityOfficerUserId,
    "gateEvent.inspectionStarted",
    { startedAt: new Date() },
  );
  return started ?? gateEvent;
}

// --- Identity verification --------------------------------------------------

export async function moveToIdentityPending(tenantId: string, gateEventId: string, actorUserId: string) {
  return transitionGateEvent(tenantId, gateEventId, "IDENTITY_PENDING", actorUserId, "gateEvent.identityPending");
}

export interface VerifyIdentityResult {
  gateEvent: Awaited<ReturnType<typeof prisma.gateEvent.update>> | null;
  outcome: Awaited<ReturnType<FacialVerificationProvider["verifyDriver"]>>;
}

/**
 * Wires the existing FacialVerificationProvider (mock in dev) into the gate
 * flow — build brief GATE item 5. Does not build a new verification
 * mechanism; only records the outcome against this GateEvent and advances
 * the state machine on a VERIFIED result. Any other result leaves the event
 * in IDENTITY_PENDING for the officer to retry, request a manual fallback
 * (existing ManualFacialVerificationFallback flow), or raise an exception.
 */
export async function verifyIdentityForGateEvent(
  tenantId: string,
  gateEventId: string,
  actorUserId: string,
  capturedImageRef: string,
  provider: FacialVerificationProvider = defaultProvider,
): Promise<VerifyIdentityResult | null> {
  const gateEvent = await prisma.gateEvent.findFirst({ where: tenantWhere(tenantId, { id: gateEventId }) });
  if (!gateEvent) return null;
  if (gateEvent.status !== "IDENTITY_PENDING") {
    throw new GateEventPreconditionError(
      `Gate event must be IDENTITY_PENDING to attempt verification (current: ${gateEvent.status}).`,
    );
  }

  const outcome = await provider.verifyDriver(gateEvent.driverId, capturedImageRef);

  await prisma.gateEvent.update({
    where: { id: gateEventId },
    data: {
      identityVerificationResult: outcome.result,
      identityVerificationRef: outcome.providerReference,
      identityVerifiedAt: outcome.result === "VERIFIED" ? outcome.verifiedAt : null,
    },
  });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "gateEvent.identityVerificationAttempted",
    entityType: "GateEvent",
    entityId: gateEventId,
    afterValue: { result: outcome.result, providerReference: outcome.providerReference, synthetic: outcome.synthetic, disclosure: outcome.disclosure },
  });

  let updated = null;
  if (outcome.result === "VERIFIED") {
    updated = await transitionGateEvent(tenantId, gateEventId, "IDENTITY_VERIFIED", actorUserId, "gateEvent.identityVerified");
  }

  return { gateEvent: updated, outcome };
}

export interface RunOnDeviceFacialVerificationInput {
  tenantId: string;
  gateEventId: string;
  securityOfficerUserId: string;
  /** A 128-dimension face descriptor computed client-side (never raw video/images sent to the server) — undefined means the capture itself failed (e.g. no face detected in time). */
  liveDescriptor?: number[];
  captureQualityScore?: number;
  livenessResult?: LivenessChallengeResult;
  livenessChallenge?: string;
  deviceLabel?: string;
  /** Set by the client when the on-device model itself failed to load/run (e.g. the CDN model fetch failed, or the browser lacks WASM/WebGL support) — distinct from CAPTURE_FAILED, which means the provider ran fine but couldn't get a usable face capture in time. */
  providerUnavailable?: boolean;
  /** Tenant-scoped retry key. A duplicate returns the original audited attempt without creating a second row or transition. */
  idempotencyKey?: string;
}

export interface RunOnDeviceFacialVerificationResult {
  gateEvent: Awaited<ReturnType<typeof prisma.gateEvent.update>> | null;
  attempt: Awaited<ReturnType<typeof prisma.facialVerificationAttempt.create>>;
  duplicate: boolean;
}

/**
 * Phase 9D — real one-to-one facial verification: compares a live-captured
 * descriptor against exactly the ONE driver assigned to this GateEvent's own
 * enrolled template (`getActiveTemplateDescriptorForDriver`) — never a
 * global identification search across every enrolled driver, and never
 * across tenants (the lookup is tenant-scoped the same as every other
 * repository call here). Records a full audit row
 * (`FacialVerificationAttempt`) for every attempt regardless of outcome —
 * MATCH, NO_MATCH, REVIEW_REQUIRED, NOT_ENROLLED, CAPTURE_FAILED,
 * LIVENESS_FAILED. Advances the gate event's state machine only on a
 * genuine MATCH; every other outcome leaves the event in IDENTITY_PENDING
 * for the officer to retry or fall back to the existing
 * ManualFacialVerificationFallback workflow — facial matching alone must
 * never approve an unapproved movement (SECURITY_AND_POPIA.md, Phase 9G).
 * A FAILED liveness result short-circuits before any match is even
 * attempted, so a spoofed still photo can never produce a MATCH result no
 * matter how close its descriptor is.
 */
// Phase 9G rate limit: caps how many verification attempts one gate event
// can accumulate in a short window before the officer must escalate to a
// supervisor rather than retrying indefinitely — same "repeated failures
// escalate" principle as the client-side liveness retry limit
// (lib/facial-verification/liveness-challenge.ts's shouldEscalateAfterFailure),
// enforced server-side too so it can't be bypassed by a client that simply
// stops calling that function.
export const VERIFICATION_ATTEMPT_RATE_LIMIT = 5;
export const VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES = 5;

export async function runOnDeviceFacialVerificationAttempt(input: RunOnDeviceFacialVerificationInput): Promise<RunOnDeviceFacialVerificationResult | null> {
  if (input.idempotencyKey) {
    const existing = await prisma.facialVerificationAttempt.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.gateEventId !== input.gateEventId || existing.securityOfficerUserId !== input.securityOfficerUserId) {
        throw new GateEventPreconditionError("The idempotency key is already bound to another verification attempt.");
      }
      return { gateEvent: null, attempt: existing, duplicate: true };
    }
  }

  const gateEvent = await prisma.gateEvent.findFirst({ where: tenantWhere(input.tenantId, { id: input.gateEventId }) });
  if (!gateEvent) return null;
  if (gateEvent.status !== "IDENTITY_PENDING") {
    throw new GateEventPreconditionError(
      `Gate event must be IDENTITY_PENDING to attempt verification (current: ${gateEvent.status}).`,
    );
  }

  const windowStart = new Date(Date.now() - VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES * 60 * 1000);
  const recentAttemptCount = await prisma.facialVerificationAttempt.count({
    where: { tenantId: input.tenantId, gateEventId: gateEvent.id, attemptedAt: { gte: windowStart } },
  });
  if (recentAttemptCount >= VERIFICATION_ATTEMPT_RATE_LIMIT) {
    throw new TooManyVerificationAttemptsError(VERIFICATION_ATTEMPT_RATE_LIMIT, VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES);
  }

  const livenessResult: LivenessChallengeResult = input.livenessResult ?? "NOT_REQUIRED";
  let result: FacialVerificationResultType;
  let confidenceScore: number | undefined;
  let threshold: number | undefined;
  let templateId: string | undefined;
  let templateVersion: string | undefined;
  let modelVersion: string | undefined;

  if (input.providerUnavailable) {
    result = "PROVIDER_UNAVAILABLE";
  } else if (livenessResult === "FAILED") {
    result = "LIVENESS_FAILED";
  } else if (!input.liveDescriptor) {
    result = "CAPTURE_FAILED";
  } else {
    const enrolled = await getActiveTemplateDescriptorForDriver(input.tenantId, gateEvent.driverId);
    if (!enrolled) {
      result = "NOT_ENROLLED";
    } else {
      const match = evaluateMatch(input.liveDescriptor, enrolled.descriptor, DEFAULT_MATCH_THRESHOLD, DEFAULT_REVIEW_THRESHOLD);
      result = match.outcome;
      confidenceScore = match.confidence;
      threshold = DEFAULT_MATCH_THRESHOLD;
      templateId = enrolled.templateId;
      templateVersion = enrolled.templateVersion;
      modelVersion = enrolled.modelVersion;
    }
  }

  const attempt = await prisma.facialVerificationAttempt.create({
    data: {
      tenantId: input.tenantId,
      gateEventId: gateEvent.id,
      driverId: gateEvent.driverId,
      templateId,
      result,
      idempotencyKey: input.idempotencyKey,
      confidenceScore,
      threshold,
      templateVersion,
      modelVersion,
      captureQualityScore: input.captureQualityScore,
      livenessResult,
      livenessChallenge: input.livenessChallenge,
      source: "ON_DEVICE",
      gateId: gateEvent.gateId,
      deviceLabel: input.deviceLabel,
      securityOfficerUserId: input.securityOfficerUserId,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.securityOfficerUserId,
    action: "facialVerification.attemptRecorded",
    entityType: "FacialVerificationAttempt",
    entityId: attempt.id,
    afterValue: { gateEventId: gateEvent.id, driverId: gateEvent.driverId, result, livenessResult, confidenceScore },
  });

  await prisma.gateEvent.update({
    where: { id: gateEvent.id },
    data: {
      identityVerificationResult: result,
      identityVerificationRef: attempt.id,
      identityVerifiedAt: result === "MATCH" ? attempt.attemptedAt : null,
    },
  });

  let updatedGateEvent = null;
  if (result === "MATCH") {
    updatedGateEvent = await transitionGateEvent(input.tenantId, gateEvent.id, "IDENTITY_VERIFIED", input.securityOfficerUserId, "gateEvent.identityVerified");
  }

  return { gateEvent: updatedGateEvent, attempt, duplicate: false };
}

export async function runSyntheticFacialVerificationAttempt(input: {
  tenantId: string;
  gateEventId: string;
  securityOfficerUserId: string;
  scenario: BiometricSimulatorScenario;
  idempotencyKey: string;
}): Promise<RunOnDeviceFacialVerificationResult | null> {
  const existing = await prisma.facialVerificationAttempt.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (existing.gateEventId !== input.gateEventId || existing.securityOfficerUserId !== input.securityOfficerUserId) {
      throw new GateEventPreconditionError("The idempotency key is already bound to another verification attempt.");
    }
    return { gateEvent: null, attempt: existing, duplicate: true };
  }

  const gateEvent = await prisma.gateEvent.findFirst({
    where: tenantWhere(input.tenantId, { id: input.gateEventId }),
  });
  if (!gateEvent) return null;
  if (gateEvent.status !== "IDENTITY_PENDING") {
    throw new GateEventPreconditionError(
      `Gate event must be IDENTITY_PENDING to attempt verification (current: ${gateEvent.status}).`,
    );
  }
  const windowStart = new Date(Date.now() - VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES * 60 * 1000);
  const recentAttemptCount = await prisma.facialVerificationAttempt.count({
    where: { tenantId: input.tenantId, gateEventId: gateEvent.id, attemptedAt: { gte: windowStart } },
  });
  if (recentAttemptCount >= VERIFICATION_ATTEMPT_RATE_LIMIT) {
    throw new TooManyVerificationAttemptsError(VERIFICATION_ATTEMPT_RATE_LIMIT, VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES);
  }

  const template = await prisma.driverFacialTemplate.findFirst({
    where: tenantWhere(input.tenantId, { driverId: gateEvent.driverId, status: "ACTIVE" as const }),
    select: { id: true, tenantId: true, templateVersion: true, modelVersion: true, version: true },
  });
  const simulator = new DeterministicBiometricSimulator(input.scenario);
  const simulated = template
    ? await simulator.verify({
        tenantId: input.tenantId,
        templateTenantId: template.tenantId,
        driverId: gateEvent.driverId,
        providerTemplateReference: `synthetic-template:${template.id}:v${template.version}`,
        requestId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        artifact: {
          opaqueReference: `private://synthetic/${input.idempotencyKey}`,
          sha256: "0".repeat(64),
          mimeType: "image/png",
          byteLength: 1,
        },
        decisionThreshold: DEFAULT_MATCH_THRESHOLD,
      })
    : null;
  const result: FacialVerificationResultType = !simulated
    ? "NOT_ENROLLED"
    : simulated.decision === "VERIFIED"
      ? "MATCH"
      : simulated.decision === "NOT_VERIFIED"
        ? "NO_MATCH"
        : simulated.decision === "LIVENESS_FAILED"
          ? "LIVENESS_FAILED"
          : simulated.decision === "UNAVAILABLE"
            ? "PROVIDER_UNAVAILABLE"
            : simulated.decision === "NOT_ENROLLED"
              ? "NOT_ENROLLED"
              : "REVIEW_REQUIRED";
  const livenessResult: LivenessChallengeResult =
    simulated?.liveness.decision === "PASSED"
      ? "PASSED"
      : simulated?.liveness.decision === "FAILED"
        ? "FAILED"
        : "NOT_REQUIRED";

  const attempt = await prisma.facialVerificationAttempt.create({
    data: {
      tenantId: input.tenantId,
      gateEventId: gateEvent.id,
      driverId: gateEvent.driverId,
      templateId: template?.id,
      result,
      idempotencyKey: input.idempotencyKey,
      confidenceScore: simulated?.confidence,
      threshold: DEFAULT_MATCH_THRESHOLD,
      templateVersion: template?.templateVersion,
      modelVersion: template?.modelVersion,
      providerId: simulated?.provenance.providerId ?? "genbridge-local-biometric-simulator",
      providerVersion: simulated?.provenance.providerVersion ?? "phase17a-v1",
      policyVersion: simulated?.provenance.policyVersion ?? "synthetic-policy-v1",
      synthetic: true,
      syntheticDisclosure: SYNTHETIC_BIOMETRIC_LABEL,
      safeErrorCode: simulated?.reasonCode,
      livenessResult,
      source: "ON_DEVICE",
      gateId: gateEvent.gateId,
      deviceLabel: "synthetic-no-camera",
      securityOfficerUserId: input.securityOfficerUserId,
    },
  });
  await recordAudit({
    tenantId: input.tenantId,
    userId: input.securityOfficerUserId,
    action: "facialVerification.syntheticAttemptRecorded",
    entityType: "FacialVerificationAttempt",
    entityId: attempt.id,
    relatedGateEventId: gateEvent.id,
    afterValue: {
      driverId: gateEvent.driverId,
      result,
      scenario: input.scenario,
      synthetic: true,
      disclosure: SYNTHETIC_BIOMETRIC_LABEL,
      providerId: attempt.providerId,
      policyVersion: attempt.policyVersion,
    },
  });
  await prisma.gateEvent.update({
    where: { id: gateEvent.id },
    data: {
      identityVerificationResult: `SYNTHETIC_${result}`,
      identityVerificationRef: attempt.id,
      identityVerifiedAt: result === "MATCH" ? attempt.attemptedAt : null,
    },
  });
  const updatedGateEvent = result === "MATCH"
    ? await transitionGateEvent(input.tenantId, gateEvent.id, "IDENTITY_VERIFIED", input.securityOfficerUserId, "gateEvent.identityVerifiedSynthetic")
    : null;
  return { gateEvent: updatedGateEvent, attempt, duplicate: false };
}

export async function listFacialVerificationAttemptsForGateEvent(tenantId: string, gateEventId: string) {
  return prisma.facialVerificationAttempt.findMany({
    where: tenantWhere(tenantId, { gateEventId }),
    orderBy: { attemptedAt: "desc" },
  });
}

/** Officer confirms identity after a supervisor APPROVED a manual fallback request for this driver. */
export async function markIdentityVerifiedManually(
  tenantId: string,
  gateEventId: string,
  actorUserId: string,
  manualFallbackId: string,
) {
  const gateEvent = await prisma.gateEvent.findFirst({
    where: tenantWhere(tenantId, { id: gateEventId }),
    select: { id: true, driverId: true, status: true },
  });
  if (!gateEvent) return null;
  if (gateEvent.status !== "IDENTITY_PENDING") {
    throw new GateEventPreconditionError(
      `Gate event must be IDENTITY_PENDING to apply manual fallback (current: ${gateEvent.status}).`,
    );
  }
  const fallback = await prisma.manualFacialVerificationFallback.findFirst({
    where: tenantWhere(tenantId, { id: manualFallbackId }),
  });
  if (!fallback || fallback.status !== "APPROVED") {
    throw new ManualFallbackNotApprovedError();
  }
  if (
    fallback.driverId !== gateEvent.driverId ||
    fallback.relatedGateEventId !== gateEvent.id
  ) {
    throw new ManualFallbackNotApprovedError();
  }

  await prisma.gateEvent.update({
    where: { id: gateEventId },
    data: {
      identityVerificationResult: "MANUAL_FALLBACK_APPROVED",
      identityVerificationRef: fallback.id,
      identityVerifiedAt: new Date(),
    },
  });

  return transitionGateEvent(tenantId, gateEventId, "IDENTITY_VERIFIED", actorUserId, "gateEvent.identityVerifiedManually");
}

// --- Guided vehicle inspection ----------------------------------------------

export async function beginVehicleChecks(tenantId: string, gateEventId: string, actorUserId: string) {
  return transitionGateEvent(tenantId, gateEventId, "VEHICLE_CHECKS_IN_PROGRESS", actorUserId, "gateEvent.vehicleChecksStarted");
}

export interface RecordInspectionResultInput {
  tenantId: string;
  gateEventId: string;
  inspectionItemId: string;
  actorUserId: string;
  outcome: InspectionOutcome;
  readingValue?: string | null;
  readingUnit?: string | null;
  comment?: string | null;
  // A MediaAsset id, previously uploaded via POST /api/media/upload with
  // ownerType=GATE_EVENT_INSPECTION_ITEM and ownerId=this gateEventId — not
  // an arbitrary string (Phase 4, see DECISIONS.md D-012). Validated below.
  evidenceMediaAssetId?: string | null;
}

export async function recordInspectionResult(input: RecordInspectionResultInput) {
  const gateEvent = await prisma.gateEvent.findFirst({ where: tenantWhere(input.tenantId, { id: input.gateEventId }) });
  if (!gateEvent) return null;
  if (gateEvent.status !== "VEHICLE_CHECKS_IN_PROGRESS") {
    throw new GateEventPreconditionError(
      `Gate event must be VEHICLE_CHECKS_IN_PROGRESS to record inspection results (current: ${gateEvent.status}).`,
    );
  }

  const item = await prisma.inspectionItem.findFirst({
    where: { id: input.inspectionItemId, template: { tenantId: input.tenantId, id: gateEvent.inspectionTemplateId ?? undefined } },
  });
  if (!item) throw new InspectionItemNotFoundError();

  if (input.evidenceMediaAssetId) {
    const evidence = await prisma.mediaAsset.findFirst({
      where: tenantWhere(input.tenantId, {
        id: input.evidenceMediaAssetId,
        ownerType: "GATE_EVENT_INSPECTION_ITEM" as const,
        ownerId: input.gateEventId,
      }),
    });
    if (!evidence) throw new EvidenceMediaAssetNotFoundError();
  }

  const isFail = input.outcome === "FAIL";
  const severity: ExceptionSeverity | null = isFail ? (item.defaultExceptionSeverity ?? "MEDIUM") : null;
  const requiresSupervisorApproval =
    isFail && (item.requiresSupervisorApprovalOnFail || severity === "HIGH" || severity === "CRITICAL");

  const result = await prisma.gateEventInspectionItem.upsert({
    where: { gateEventId_inspectionItemId: { gateEventId: input.gateEventId, inspectionItemId: input.inspectionItemId } },
    update: {
      outcome: input.outcome,
      readingValue: input.readingValue ?? null,
      readingUnit: input.readingUnit ?? null,
      comment: input.comment ?? null,
      evidenceMediaAssetId: input.evidenceMediaAssetId ?? null,
      exceptionSeverity: severity,
      supervisorApprovalRequired: requiresSupervisorApproval,
      recordedByUserId: input.actorUserId,
      recordedAt: new Date(),
    },
    create: {
      tenantId: input.tenantId,
      gateEventId: input.gateEventId,
      inspectionItemId: input.inspectionItemId,
      outcome: input.outcome,
      readingValue: input.readingValue ?? null,
      readingUnit: input.readingUnit ?? null,
      comment: input.comment ?? null,
      evidenceMediaAssetId: input.evidenceMediaAssetId ?? null,
      exceptionSeverity: severity,
      supervisorApprovalRequired: requiresSupervisorApproval,
      recordedByUserId: input.actorUserId,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "gateEvent.inspectionResultRecorded",
    entityType: "GateEventInspectionItem",
    entityId: result.id,
    afterValue: { inspectionItemId: input.inspectionItemId, outcome: input.outcome },
  });

  let exception = null;
  if (isFail) {
    exception = await raiseException({
      tenantId: input.tenantId,
      gateEventId: input.gateEventId,
      actorUserId: input.actorUserId,
      description: `Inspection item "${item.label}" failed.`,
      severity: severity ?? "MEDIUM",
      requiresSupervisorApproval,
      inspectionResultId: result.id,
    });
  }

  return { result, exception };
}

// --- Exceptions --------------------------------------------------------------

export interface RaiseExceptionInput {
  tenantId: string;
  gateEventId: string;
  actorUserId: string;
  description: string;
  severity?: ExceptionSeverity;
  requiresSupervisorApproval?: boolean;
  exceptionTypeId?: string | null;
  inspectionResultId?: string | null;
}

export async function raiseException(input: RaiseExceptionInput) {
  const gateEvent = await prisma.gateEvent.findFirst({ where: tenantWhere(input.tenantId, { id: input.gateEventId }) });
  if (!gateEvent) return null;

  let severity = input.severity ?? "MEDIUM";
  let requiresSupervisorApproval = input.requiresSupervisorApproval ?? false;
  if (input.exceptionTypeId) {
    const exceptionType = await prisma.exceptionType.findFirst({
      where: tenantWhere(input.tenantId, { id: input.exceptionTypeId }),
    });
    if (exceptionType) {
      severity = input.severity ?? exceptionType.defaultSeverity;
      requiresSupervisorApproval = input.requiresSupervisorApproval ?? exceptionType.requiresSupervisorApproval;
    }
  }

  const exception = await prisma.exception.create({
    data: {
      tenantId: input.tenantId,
      gateEventId: input.gateEventId,
      inspectionResultId: input.inspectionResultId ?? null,
      exceptionTypeId: input.exceptionTypeId ?? null,
      description: input.description,
      severity,
      requiresSupervisorApproval,
      raisedByUserId: input.actorUserId,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "gateEvent.exceptionRaised",
    entityType: "Exception",
    entityId: exception.id,
    afterValue: { severity, requiresSupervisorApproval, description: input.description },
  });

  if (isValidGateEventTransition(gateEvent.status as GateEventStatus, "EXCEPTION_RAISED")) {
    await transitionGateEvent(input.tenantId, input.gateEventId, "EXCEPTION_RAISED", input.actorUserId, "gateEvent.movedToExceptionRaised");
  }

  return exception;
}

export async function escalateExceptionToSupervisor(tenantId: string, gateEventId: string, actorUserId: string) {
  return transitionGateEvent(tenantId, gateEventId, "SUPERVISOR_REVIEW", actorUserId, "gateEvent.escalatedToSupervisorReview");
}

const CONTINUE_OUTCOMES = new Set<ExceptionOutcomeAction>([
  "WARNING",
  "CLEARED_WITH_OBSERVATION",
  "MANUAL_REVIEW",
  "SUPERVISOR_APPROVAL",
]);
const BLOCK_OUTCOMES = new Set<ExceptionOutcomeAction>(["WORKSHOP_LOCKOUT", "SECURITY_HOLD", "DENIED"]);

export interface ResolveExceptionInput {
  tenantId: string;
  exceptionId: string;
  actorUserId: string;
  outcomeAction: ExceptionOutcomeAction;
  resolutionNotes?: string | null;
}

/**
 * Resolves an open exception. Enforces the hard self-approval rule for
 * exceptions marked `requiresSupervisorApproval` (build brief GATE item 3 /
 * TESTING.md "Gate officer cannot approve their own serious exception") —
 * this check is unconditional, unlike MovementAuthorisation's
 * Tenant.allowSelfApproveMovement toggle (see DECISIONS.md for why exceptions
 * deliberately don't get an equivalent opt-out).
 */
export async function resolveException(input: ResolveExceptionInput) {
  const exception = await prisma.exception.findFirst({
    where: tenantWhere(input.tenantId, { id: input.exceptionId }),
    include: { gateEvent: true },
  });
  if (!exception) return null;
  if (!exception.gateEventId || !exception.gateEvent) throw new NotAGateEventExceptionError();
  if (exception.resolvedAt) throw new ExceptionAlreadyResolvedError();

  if (exception.requiresSupervisorApproval) {
    if (exception.raisedByUserId === input.actorUserId) throw new SelfApprovalNotAllowedError();
    if (exception.gateEvent.status !== "SUPERVISOR_REVIEW") throw new ExceptionNotEscalatedError();
  } else if (exception.gateEvent.status !== "EXCEPTION_RAISED" && exception.gateEvent.status !== "SUPERVISOR_REVIEW") {
    throw new GateEventPreconditionError(
      `Gate event is not awaiting exception resolution (current: ${exception.gateEvent.status}).`,
    );
  }

  const nextGateEventStatus: GateEventStatus = BLOCK_OUTCOMES.has(input.outcomeAction)
    ? "DENIED"
    : CONTINUE_OUTCOMES.has(input.outcomeAction)
      ? "VEHICLE_CHECKS_IN_PROGRESS"
      : "VEHICLE_CHECKS_IN_PROGRESS";

  const updatedException = await prisma.exception.update({
    where: { id: exception.id },
    data: {
      outcomeAction: input.outcomeAction,
      resolutionNotes: input.resolutionNotes ?? null,
      resolvedByUserId: input.actorUserId,
      resolvedAt: new Date(),
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "gateEvent.exceptionResolved",
    entityType: "Exception",
    entityId: exception.id,
    beforeValue: { outcomeAction: null },
    afterValue: { outcomeAction: input.outcomeAction },
  });

  const extra: Prisma.GateEventUncheckedUpdateInput =
    nextGateEventStatus === "DENIED"
      ? { decision: "DENIED", decisionReason: input.resolutionNotes ?? exception.description, decisionByUserId: input.actorUserId, decisionAt: new Date() }
      : {};

  const updatedGateEvent = await transitionGateEvent(
    input.tenantId,
    exception.gateEventId,
    nextGateEventStatus,
    input.actorUserId,
    nextGateEventStatus === "DENIED" ? "gateEvent.deniedViaException" : "gateEvent.resumedAfterException",
    extra,
  );

  return { exception: updatedException, gateEvent: updatedGateEvent };
}

export async function listExceptionsForGateEvent(tenantId: string, gateEventId: string) {
  return prisma.exception.findMany({
    where: tenantWhere(tenantId, { gateEventId }),
    orderBy: { raisedAt: "desc" },
  });
}

// --- Clearance decision ------------------------------------------------------

export interface DecisionInput {
  tenantId: string;
  gateEventId: string;
  actorUserId: string;
  reason?: string | null;
}

export async function clearGateEvent(input: DecisionInput) {
  const gateEvent = await prisma.gateEvent.findFirst({ where: tenantWhere(input.tenantId, { id: input.gateEventId }) });
  if (!gateEvent) return null;

  // Defense-in-depth: re-check the vehicle hasn't been locked since the
  // event started (TESTING.md "Vehicle lockout prevents normal clearance").
  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: gateEvent.vehicleId } });
  if (!isVehicleAvailableForMovement(vehicle)) throw new VehicleNotAvailableError(vehicle.operationalStatus);

  const updated = await transitionGateEvent(input.tenantId, input.gateEventId, "CLEARED", input.actorUserId, "gateEvent.cleared", {
    decision: "CLEARED",
    decisionReason: input.reason ?? null,
    decisionByUserId: input.actorUserId,
    decisionAt: new Date(),
  });
  if (!updated) return null;

  // Best-effort wiring into the movement lifecycle: an ENTRY clearance moves
  // the movement APPROVED -> IN_PROGRESS. Not fatal if the movement is
  // already past that state for any reason — reconciliation/exit handling is
  // Phase 5 scope, this is a minimal, non-blocking link forward.
  if (gateEvent.direction === "ENTRY") {
    const movement = await prisma.movementAuthorisation.findUnique({ where: { id: gateEvent.movementAuthorisationId } });
    if (movement?.status === "APPROVED") {
      await startMovement(input.tenantId, movement.id, input.actorUserId);
    }
  }

  return updated;
}

export async function denyGateEvent(input: DecisionInput & { reason: string }) {
  return transitionGateEvent(input.tenantId, input.gateEventId, "DENIED", input.actorUserId, "gateEvent.denied", {
    decision: "DENIED",
    decisionReason: input.reason,
    decisionByUserId: input.actorUserId,
    decisionAt: new Date(),
  });
}

export async function completeGateEvent(tenantId: string, gateEventId: string, actorUserId: string) {
  const gateEvent = await prisma.gateEvent.findFirst({ where: tenantWhere(tenantId, { id: gateEventId }) });
  if (!gateEvent) return null;

  const updated = await transitionGateEvent(tenantId, gateEventId, "COMPLETED", actorUserId, "gateEvent.completed", {
    completedAt: new Date(),
  });
  if (!updated) return null;

  if (gateEvent.direction === "EXIT" && gateEvent.decision === "CLEARED") {
    const movement = await prisma.movementAuthorisation.findUnique({ where: { id: gateEvent.movementAuthorisationId } });
    if (movement?.status === "IN_PROGRESS") {
      await completeMovement(tenantId, movement.id, actorUserId);
    }
  }

  // Best-effort wiring into Phase 5B reconciliation: every time a gate event
  // completes CLEARED, try to pair it with an earlier completed leg of the
  // same movement. Not fatal if the other leg doesn't exist yet (the common
  // case — this fires on the departure leg too, when there's nothing to pair
  // against yet) or if reconciliation is otherwise not ready; a genuinely
  // unexpected failure is logged, not swallowed silently, but never blocks
  // gate event completion itself (same "not fatal" pattern as the movement
  // wiring above).
  if (gateEvent.decision === "CLEARED") {
    try {
      await buildReconciliation({ tenantId, movementAuthorisationId: gateEvent.movementAuthorisationId, actorUserId });
    } catch (err) {
      if (!(err instanceof ReconciliationNotReadyError)) logger.error("reconciliation.auto_build_failed", { error: err });
    }
  }

  return updated;
}

export async function cancelGateEvent(tenantId: string, gateEventId: string, actorUserId: string, reason?: string | null) {
  return transitionGateEvent(tenantId, gateEventId, "CANCELLED", actorUserId, "gateEvent.cancelled", {
    decisionReason: reason ?? null,
  });
}

// --- Reads ---------------------------------------------------------------

export interface ListGateEventsOptions {
  status?: GateEventStatus;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function listGateEventsInTenant(tenantId: string, options: ListGateEventsOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = tenantWhere(tenantId, options.status ? { status: options.status } : {});

  const [items, total] = await Promise.all([
    prisma.gateEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { vehicle: true, driver: true, gate: true, site: true, securityOfficer: true, movementAuthorisation: true },
    }),
    prisma.gateEvent.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getGateEventInTenant(tenantId: string, gateEventId: string) {
  return prisma.gateEvent.findFirst({
    where: tenantWhere(tenantId, { id: gateEventId }),
    include: {
      vehicle: true,
      trailerVehicle: true,
      driver: true,
      gate: true,
      site: true,
      securityOfficer: true,
      decisionBy: true,
      movementAuthorisation: true,
      inspectionTemplate: { include: { items: { orderBy: [{ section: "asc" }, { sortOrder: "asc" }] } } },
      inspectionResults: { include: { inspectionItem: true, recordedBy: true } },
      exceptions: { include: { raisedBy: true, resolvedBy: true, exceptionType: true }, orderBy: { raisedAt: "desc" } },
    },
  });
}
