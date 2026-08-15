import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  enrolDriver,
  revokeDriverFacialTemplate,
  getActiveTemplateDescriptorForDriver,
  getFacialEnrolmentStatus,
  listFacialTemplateHistoryForDriver,
  DriverNotFoundError,
  ConsentNotAcknowledgedError,
  InsufficientCapturesError,
  InconsistentCapturesError,
  NoActiveTemplateError,
  TEMPLATE_VERSION,
  MODEL_VERSION,
} from "@/lib/repositories/facial-enrolment-repository";
import { createTenant, createRole, createUser, createDriver } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

/** Small, deterministic, mutually-consistent "captures" for one synthetic identity. */
function consistentCaptures(identitySeed: number, count = 3, length = 128): number[][] {
  const base = Array.from({ length }, (_, i) => Math.sin(identitySeed + i) * 5);
  return Array.from({ length: count }, (_, captureIndex) =>
    base.map((v, i) => v + Math.sin(captureIndex * 7 + i) * 0.01), // tiny per-capture noise
  );
}

function differentIdentityCapture(identitySeed: number, length = 128): number[] {
  return Array.from({ length }, (_, i) => Math.cos(identitySeed + i) * 5 + 3);
}

describe("Phase 9C: facial-enrolment-repository", () => {
  it("enrols a driver from 3-5 guided captures, storing only the encrypted mean descriptor", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const template = await enrolDriver({
      tenantId: tenant.id,
      actorUserId: actor.id,
      driverId: driver.id,
      captureDescriptors: consistentCaptures(1),
      consentAcknowledged: true,
    });

    expect(template.status).toBe("ACTIVE");
    expect(template.templateVersion).toBe(TEMPLATE_VERSION);
    expect(template.modelVersion).toBe(MODEL_VERSION);
    expect(template.consentAcknowledgedAt).toBeInstanceOf(Date);

    // Never stores raw captures or plaintext — only ciphertext + iv + authTag.
    expect(template.templateCiphertext).toBeInstanceOf(Uint8Array);
    expect(template.templateCiphertext).not.toBeNull();
    expect(template.templateCiphertext!.length).toBeGreaterThan(0);

    const status = await getFacialEnrolmentStatus(tenant.id, driver.id);
    expect(status.enrolled).toBe(true);
    expect(status.enrolledByUserId).toBe(actor.id);

    const driverRow = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(driverRow.facialVerificationEnrolled).toBe(true);
  });

  it("rejects enrolment without consent acknowledgement", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(
      enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: consistentCaptures(2), consentAcknowledged: false }),
    ).rejects.toBeInstanceOf(ConsentNotAcknowledgedError);
  });

  it("rejects enrolment with fewer than 3 or more than 5 captures", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(
      enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: consistentCaptures(3, 2), consentAcknowledged: true }),
    ).rejects.toBeInstanceOf(InsufficientCapturesError);

    await expect(
      enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: consistentCaptures(3, 6), consentAcknowledged: true }),
    ).rejects.toBeInstanceOf(InsufficientCapturesError);
  });

  it("rejects enrolment when the captures are not mutually consistent (likely different people / bad captures)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const captures = consistentCaptures(4, 2);
    captures.push(differentIdentityCapture(4));

    await expect(
      enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: captures, consentAcknowledged: true }),
    ).rejects.toBeInstanceOf(InconsistentCapturesError);
  });

  it("rejects enrolment for a driver that does not exist in this tenant", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);

    await expect(
      enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: "nonexistent-driver-id", captureDescriptors: consistentCaptures(5), consentAcknowledged: true }),
    ).rejects.toBeInstanceOf(DriverNotFoundError);
  });

  it("re-enrolment revokes the previous ACTIVE template and leaves exactly one ACTIVE row", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const first = await enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: consistentCaptures(6), consentAcknowledged: true });
    const second = await enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: consistentCaptures(7), consentAcknowledged: true });

    expect(second.id).not.toBe(first.id);

    const history = await listFacialTemplateHistoryForDriver(tenant.id, driver.id);
    expect(history).toHaveLength(2);
    const activeRows = history.filter((h) => h.status === "ACTIVE");
    const revokedRows = history.filter((h) => h.status === "REVOKED");
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].id).toBe(second.id);
    expect(revokedRows).toHaveLength(1);
    expect(revokedRows[0].id).toBe(first.id);
  });

  it("revokes an active template and clears the driver's enrolled flag", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: consistentCaptures(8), consentAcknowledged: true });

    const revoked = await revokeDriverFacialTemplate(tenant.id, actor.id, driver.id, "Driver no longer employed");
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedReason).toBe("Driver no longer employed");

    const status = await getFacialEnrolmentStatus(tenant.id, driver.id);
    expect(status.enrolled).toBe(false);

    const driverRow = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(driverRow.facialVerificationEnrolled).toBe(false);
  });

  it("revoking a driver with no active template throws", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(revokeDriverFacialTemplate(tenant.id, actor.id, driver.id, "no template")).rejects.toBeInstanceOf(NoActiveTemplateError);
  });

  it("getActiveTemplateDescriptorForDriver decrypts back to (approximately) the enrolled mean, and returns null once revoked", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const captures = consistentCaptures(9);
    await enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: captures, consentAcknowledged: true });

    const decrypted = await getActiveTemplateDescriptorForDriver(tenant.id, driver.id);
    expect(decrypted).not.toBeNull();
    expect(decrypted!.descriptor).toHaveLength(128);
    expect(decrypted!.templateVersion).toBe(TEMPLATE_VERSION);

    await revokeDriverFacialTemplate(tenant.id, actor.id, driver.id, "test");
    const afterRevoke = await getActiveTemplateDescriptorForDriver(tenant.id, driver.id);
    expect(afterRevoke).toBeNull();
  });

  it("never returns template bytes from getFacialEnrolmentStatus or listFacialTemplateHistoryForDriver", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await enrolDriver({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, captureDescriptors: consistentCaptures(10), consentAcknowledged: true });

    const status = await getFacialEnrolmentStatus(tenant.id, driver.id);
    expect(Object.keys(status)).not.toContain("templateCiphertext");

    const history = await listFacialTemplateHistoryForDriver(tenant.id, driver.id);
    for (const row of history) {
      expect(Object.keys(row)).not.toContain("templateCiphertext");
      expect(Object.keys(row)).not.toContain("templateIv");
      expect(Object.keys(row)).not.toContain("templateAuthTag");
    }
  });

  it("never crosses tenant boundaries for enrolment status or template decryption", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorA = await makeActor(tenantA.id);
    const driverA = await createDriver(tenantA.id);
    await enrolDriver({ tenantId: tenantA.id, actorUserId: actorA.id, driverId: driverA.id, captureDescriptors: consistentCaptures(11), consentAcknowledged: true });

    const crossTenantStatus = await getFacialEnrolmentStatus(tenantB.id, driverA.id);
    expect(crossTenantStatus.enrolled).toBe(false);

    const crossTenantDescriptor = await getActiveTemplateDescriptorForDriver(tenantB.id, driverA.id);
    expect(crossTenantDescriptor).toBeNull();
  });
});
