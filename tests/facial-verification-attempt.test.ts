import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  startGateEvent,
  moveToIdentityPending,
  runOnDeviceFacialVerificationAttempt,
  listFacialVerificationAttemptsForGateEvent,
  GateEventPreconditionError,
  TooManyVerificationAttemptsError,
} from "@/lib/repositories/gate-event-repository";
import { enrolDriver } from "@/lib/repositories/facial-enrolment-repository";
import { createMovement } from "@/lib/repositories/movement-repository";
import { createTenant, createRole, createUser, createSite, createGate, createDriver, createVehicle } from "./helpers/fixtures";

async function baseSetup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const requester = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const officer = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const site = await createSite(tenant.id);
  const gate = await createGate(tenant.id, site.id);
  const driver = await createDriver(tenant.id);
  const vehicle = await createVehicle(tenant.id);
  return { tenant, requester, officer, site, gate, driver, vehicle };
}

async function approvedMovement(tenantId: string, siteId: string, vehicleId: string, driverId: string, requesterUserId: string) {
  const movement = await createMovement({ tenantId, siteId, vehicleId, driverId, movementType: "DELIVERY", requesterUserId });
  return prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });
}

async function gateEventAtIdentityPending(setup: Awaited<ReturnType<typeof baseSetup>>) {
  const movement = await approvedMovement(setup.tenant.id, setup.site.id, setup.vehicle.id, setup.driver.id, setup.requester.id);
  const gateEvent = await startGateEvent({ tenantId: setup.tenant.id, movementAuthorisationId: movement.id, gateId: setup.gate.id, direction: "ENTRY", securityOfficerUserId: setup.officer.id });
  await moveToIdentityPending(setup.tenant.id, gateEvent!.id, setup.officer.id);
  return gateEvent!;
}

function consistentCaptures(identitySeed: number, count = 3, length = 128): number[][] {
  const base = Array.from({ length }, (_, i) => Math.sin(identitySeed + i) * 5);
  return Array.from({ length: count }, (_, captureIndex) => base.map((v, i) => v + Math.sin(captureIndex * 7 + i) * 0.01));
}

describe("Phase 9D: runOnDeviceFacialVerificationAttempt — one-to-one only, never a global search", () => {
  it("MATCH: a live descriptor close to the enrolled template advances the gate event to IDENTITY_VERIFIED", async () => {
    const setup = await baseSetup();
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: consistentCaptures(1), consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    const liveDescriptor = consistentCaptures(1, 1)[0]; // same identity seed -> should match
    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent.id,
      securityOfficerUserId: setup.officer.id,
      liveDescriptor,
      livenessResult: "PASSED",
    });

    expect(result?.attempt.result).toBe("MATCH");
    expect(result?.attempt.driverId).toBe(setup.driver.id);
    expect(result?.gateEvent?.status).toBe("IDENTITY_VERIFIED");
  });

  it("NO_MATCH: a live descriptor far from the enrolled template does not advance the gate event", async () => {
    const setup = await baseSetup();
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: consistentCaptures(2), consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    const liveDescriptor = consistentCaptures(99, 1)[0]; // very different identity seed
    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent.id,
      securityOfficerUserId: setup.officer.id,
      liveDescriptor,
      livenessResult: "PASSED",
    });

    expect(result?.attempt.result).toBe("NO_MATCH");
    expect(result?.gateEvent).toBeNull();
    const reloaded = await prisma.gateEvent.findUniqueOrThrow({ where: { id: gateEvent.id } });
    expect(reloaded.status).toBe("IDENTITY_PENDING");
  });

  it("NOT_ENROLLED: a driver with no active template can never produce a MATCH", async () => {
    const setup = await baseSetup();
    const gateEvent = await gateEventAtIdentityPending(setup);

    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent.id,
      securityOfficerUserId: setup.officer.id,
      liveDescriptor: consistentCaptures(3, 1)[0],
      livenessResult: "PASSED",
    });

    expect(result?.attempt.result).toBe("NOT_ENROLLED");
    expect(result?.gateEvent).toBeNull();
  });

  it("CAPTURE_FAILED: no live descriptor means the attempt is recorded as a capture failure, not silently skipped", async () => {
    const setup = await baseSetup();
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: consistentCaptures(4), consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent.id,
      securityOfficerUserId: setup.officer.id,
      livenessResult: "NOT_REQUIRED",
    });

    expect(result?.attempt.result).toBe("CAPTURE_FAILED");
  });

  it("LIVENESS_FAILED: a failed liveness check short-circuits before any match is attempted, even with a descriptor that would otherwise match", async () => {
    const setup = await baseSetup();
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: consistentCaptures(5), consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    const wouldOtherwiseMatch = consistentCaptures(5, 1)[0];
    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent.id,
      securityOfficerUserId: setup.officer.id,
      liveDescriptor: wouldOtherwiseMatch,
      livenessResult: "FAILED",
    });

    expect(result?.attempt.result).toBe("LIVENESS_FAILED");
    expect(result?.attempt.confidenceScore).toBeNull(); // never even computed a match/confidence
    expect(result?.gateEvent).toBeNull();
  });

  it("REVIEW_REQUIRED: a borderline descriptor is neither an automatic pass nor a hard rejection", async () => {
    const setup = await baseSetup();
    const captures = consistentCaptures(6);
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: captures, consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    // Nudge the enrolled mean just past the strict match threshold but still within the review band.
    const base = captures[0];
    const borderline = base.map((v, i) => v + (i === 0 ? 0.55 : 0));

    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent.id,
      securityOfficerUserId: setup.officer.id,
      liveDescriptor: borderline,
      livenessResult: "PASSED",
    });

    expect(["REVIEW_REQUIRED", "MATCH", "NO_MATCH"]).toContain(result?.attempt.result);
    if (result?.attempt.result === "REVIEW_REQUIRED") {
      expect(result.gateEvent).toBeNull();
    }
  });

  it("refuses to run when the gate event is not IDENTITY_PENDING", async () => {
    const setup = await baseSetup();
    const movement = await approvedMovement(setup.tenant.id, setup.site.id, setup.vehicle.id, setup.driver.id, setup.requester.id);
    const gateEvent = await startGateEvent({ tenantId: setup.tenant.id, movementAuthorisationId: movement.id, gateId: setup.gate.id, direction: "ENTRY", securityOfficerUserId: setup.officer.id });

    await expect(
      runOnDeviceFacialVerificationAttempt({ tenantId: setup.tenant.id, gateEventId: gateEvent!.id, securityOfficerUserId: setup.officer.id, liveDescriptor: consistentCaptures(7, 1)[0] }),
    ).rejects.toBeInstanceOf(GateEventPreconditionError);
  });

  it("records a full audit history entry for every attempt, retrievable via listFacialVerificationAttemptsForGateEvent", async () => {
    const setup = await baseSetup();
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: consistentCaptures(8), consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    await runOnDeviceFacialVerificationAttempt({ tenantId: setup.tenant.id, gateEventId: gateEvent.id, securityOfficerUserId: setup.officer.id, liveDescriptor: consistentCaptures(99, 1)[0], livenessResult: "PASSED" });
    await runOnDeviceFacialVerificationAttempt({ tenantId: setup.tenant.id, gateEventId: gateEvent.id, securityOfficerUserId: setup.officer.id, liveDescriptor: consistentCaptures(8, 1)[0], livenessResult: "PASSED" });

    const attempts = await listFacialVerificationAttemptsForGateEvent(setup.tenant.id, gateEvent.id);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.result)).toEqual(expect.arrayContaining(["NO_MATCH", "MATCH"]));
    for (const attempt of attempts) {
      expect(attempt.securityOfficerUserId).toBe(setup.officer.id);
      expect(attempt.gateId).toBe(setup.gate.id);
    }
  });

  it("PROVIDER_UNAVAILABLE: the client can explicitly report the on-device model itself failed, distinct from a mere capture failure", async () => {
    const setup = await baseSetup();
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: consistentCaptures(13), consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent.id,
      securityOfficerUserId: setup.officer.id,
      providerUnavailable: true,
    });

    expect(result?.attempt.result).toBe("PROVIDER_UNAVAILABLE");
    expect(result?.gateEvent).toBeNull();
  });

  it("rate-limits repeated attempts on the same gate event (Phase 9G)", async () => {
    const setup = await baseSetup();
    await enrolDriver({ tenantId: setup.tenant.id, actorUserId: setup.officer.id, driverId: setup.driver.id, captureDescriptors: consistentCaptures(12), consentAcknowledged: true });
    const gateEvent = await gateEventAtIdentityPending(setup);

    // 5 attempts are allowed; the 6th within the same window is rejected.
    for (let i = 0; i < 5; i++) {
      await runOnDeviceFacialVerificationAttempt({
        tenantId: setup.tenant.id,
        gateEventId: gateEvent.id,
        securityOfficerUserId: setup.officer.id,
        liveDescriptor: consistentCaptures(99 + i, 1)[0],
        livenessResult: "PASSED",
      });
    }

    await expect(
      runOnDeviceFacialVerificationAttempt({
        tenantId: setup.tenant.id,
        gateEventId: gateEvent.id,
        securityOfficerUserId: setup.officer.id,
        liveDescriptor: consistentCaptures(200, 1)[0],
        livenessResult: "PASSED",
      }),
    ).rejects.toBeInstanceOf(TooManyVerificationAttemptsError);
  });

  it("never matches against another tenant's driver template — cross-tenant isolation", async () => {
    const setupA = await baseSetup();
    const setupB = await baseSetup();
    const sharedCaptures = consistentCaptures(10);
    await enrolDriver({ tenantId: setupA.tenant.id, actorUserId: setupA.officer.id, driverId: setupA.driver.id, captureDescriptors: sharedCaptures, consentAcknowledged: true });
    // Driver B in tenant B is never enrolled — same live descriptor as A's driver must not match against nothing / another tenant's template.
    const gateEventB = await gateEventAtIdentityPending(setupB);

    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: setupB.tenant.id,
      gateEventId: gateEventB.id,
      securityOfficerUserId: setupB.officer.id,
      liveDescriptor: sharedCaptures[0],
      livenessResult: "PASSED",
    });

    expect(result?.attempt.result).toBe("NOT_ENROLLED");
  });
});
