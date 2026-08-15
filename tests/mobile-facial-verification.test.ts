import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { SYNTHETIC_BIOMETRIC_LABEL } from "@/lib/facial-verification/contracts";
import { getMobileFacialVerificationContext, listMobileManualFallbacks } from "@/lib/mobile/facial-verification";
import { enrolDriver } from "@/lib/repositories/facial-enrolment-repository";
import {
  markIdentityVerifiedManually,
  ManualFallbackNotApprovedError,
  moveToIdentityPending,
  runSyntheticFacialVerificationAttempt,
  startGateEvent,
} from "@/lib/repositories/gate-event-repository";
import {
  requestManualFallback,
  resolveManualFallback,
} from "@/lib/repositories/facial-verification-repository";
import { createMovement } from "@/lib/repositories/movement-repository";
import {
  createDriver,
  createGate,
  createRole,
  createSite,
  createTenant,
  createUser,
  createVehicle,
} from "./helpers/fixtures";

function descriptors(seed: number) {
  return Array.from({ length: 3 }, (_, capture) =>
    Array.from({ length: 128 }, (_, index) => Math.sin(seed + index) * 5 + capture * 0.001),
  );
}

async function setupPendingEvent() {
  const tenant = await createTenant("Mobile facial workflow");
  const role = await createRole(tenant.id);
  const requester = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const officer = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const manager = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const site = await createSite(tenant.id);
  const gate = await createGate(tenant.id, site.id);
  const driver = await createDriver(tenant.id);
  const vehicle = await createVehicle(tenant.id);
  const movement = await createMovement({ tenantId: tenant.id, siteId: site.id, vehicleId: vehicle.id, driverId: driver.id, movementType: "DELIVERY", requesterUserId: requester.id });
  await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });
  const event = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
  await moveToIdentityPending(tenant.id, event!.id, officer.id);
  return { tenant, officer, manager, driver, event: event! };
}

describe("Android synthetic facial-verification server contract", () => {
  it("returns enrolment, explicit safe outcome, retry budget and audit confirmation without biometric material", async () => {
    const setup = await setupPendingEvent();
    await enrolDriver({
      tenantId: setup.tenant.id,
      actorUserId: setup.officer.id,
      driverId: setup.driver.id,
      captureDescriptors: descriptors(17),
      consentAcknowledged: true,
    });
    await runSyntheticFacialVerificationAttempt({
      tenantId: setup.tenant.id,
      gateEventId: setup.event.id,
      securityOfficerUserId: setup.officer.id,
      scenario: "LIVENESS_FAILURE",
      idempotencyKey: `mobile-${crypto.randomUUID()}`,
    });
    const context = await getMobileFacialVerificationContext(
      setup.tenant.id,
      setup.event.id,
      setup.officer.id,
    );
    expect(context.disclosure).toBe(SYNTHETIC_BIOMETRIC_LABEL);
    expect(context.enrolment.status).toBe("ENROLLED");
    expect(context.latestAttempt).toMatchObject({
      result: "LIVENESS_FAILED",
      livenessResult: "FAILED",
      synthetic: true,
      disclosure: SYNTHETIC_BIOMETRIC_LABEL,
    });
    expect(context.attemptsRemaining).toBe(4);
    expect(context.auditConfirmation?.recorded).toBe(true);
    expect(JSON.stringify(context)).not.toMatch(/confidence|ciphertext|descriptor|image|video/i);
  });

  it("reports not-enrolled and keeps foreign tenant attempts invisible", async () => {
    const setup = await setupPendingEvent();
    const foreign = await createTenant("Foreign mobile facial workflow");
    const context = await getMobileFacialVerificationContext(
      foreign.id,
      setup.event.id,
      setup.officer.id,
    );
    expect(context.enrolment.status).toBe("NOT_ENROLLED");
    expect(context.latestAttempt).toBeNull();
    expect(context.fallback).toBeNull();
  });

  it("enforces mandatory gate binding, driver binding, approval and separation of duties before manual override", async () => {
    const setup = await setupPendingEvent();
    const otherDriver = await createDriver(setup.tenant.id);
    const wrongDriver = await requestManualFallback({
      tenantId: setup.tenant.id,
      driverId: otherDriver.id,
      requestedByUserId: setup.officer.id,
      reason: "Synthetic mismatch requires manager review",
      relatedGateEventId: setup.event.id,
    });
    await resolveManualFallback({
      tenantId: setup.tenant.id,
      fallbackId: wrongDriver.id,
      approvedByUserId: setup.manager.id,
      decision: "APPROVED",
    });
    await expect(
      markIdentityVerifiedManually(setup.tenant.id, setup.event.id, setup.officer.id, wrongDriver.id),
    ).rejects.toBeInstanceOf(ManualFallbackNotApprovedError);

    const correct = await requestManualFallback({
      tenantId: setup.tenant.id,
      driverId: setup.driver.id,
      requestedByUserId: setup.officer.id,
      reason: "Synthetic provider unavailable; documents checked",
      relatedGateEventId: setup.event.id,
    });
    const pending = await listMobileManualFallbacks(setup.tenant.id, "PENDING", setup.officer.id);
    expect(pending.find((item) => item.id === correct.id)?.selfApprovalBlocked).toBe(true);
    await resolveManualFallback({
      tenantId: setup.tenant.id,
      fallbackId: correct.id,
      approvedByUserId: setup.manager.id,
      decision: "APPROVED",
    });
    const verified = await markIdentityVerifiedManually(
      setup.tenant.id,
      setup.event.id,
      setup.officer.id,
      correct.id,
    );
    expect(verified?.status).toBe("IDENTITY_VERIFIED");
    const audit = await prisma.auditLog.findFirst({
      where: {
        tenantId: setup.tenant.id,
        relatedGateEventId: setup.event.id,
        action: "gateEvent.identityVerifiedManually",
      },
    });
    expect(audit).not.toBeNull();
  });
});
