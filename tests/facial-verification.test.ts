import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { MockFacialVerificationProvider } from "@/lib/facial-verification/mock-provider";
import { requestManualFallback, resolveManualFallback, SelfApprovalNotAllowedError } from "@/lib/repositories/facial-verification-repository";
import { createTenant, createRole, createUser, createDriver } from "./helpers/fixtures";

describe("MockFacialVerificationProvider", () => {
  const provider = new MockFacialVerificationProvider();

  it("returns VERIFIED for a normal capture reference", async () => {
    const outcome = await provider.verifyDriver("driver-1", "dev-capture-normal");
    expect(outcome.result).toBe("VERIFIED");
    expect(outcome.providerReference).toBeTruthy();
  });

  it("returns NOT_VERIFIED when forced", async () => {
    const outcome = await provider.verifyDriver("driver-1", "dev-capture-force:not_verified");
    expect(outcome.result).toBe("NOT_VERIFIED");
    expect(outcome.failureReason).toBeTruthy();
  });

  it("returns LIVENESS_FAILED when forced", async () => {
    const outcome = await provider.verifyDriver("driver-1", "dev-capture-force:liveness_failed");
    expect(outcome.result).toBe("LIVENESS_FAILED");
  });

  it("returns PROVIDER_UNAVAILABLE when forced", async () => {
    const outcome = await provider.verifyDriver("driver-1", "dev-capture-force:unavailable");
    expect(outcome.result).toBe("PROVIDER_UNAVAILABLE");
  });

  it("returns MANUAL_FALLBACK_REQUIRED when forced", async () => {
    const outcome = await provider.verifyDriver("driver-1", "dev-capture-force:fallback");
    expect(outcome.result).toBe("MANUAL_FALLBACK_REQUIRED");
  });
});

describe("manual facial-verification fallback", () => {
  it("recording a fallback request captures reason, requester, and timestamp, and is audit-logged", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const officer = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const driver = await createDriver(tenant.id);

    const fallback = await requestManualFallback({
      tenantId: tenant.id,
      driverId: driver.id,
      requestedByUserId: officer.id,
      reason: "Camera glare prevented automated match",
    });

    expect(fallback.status).toBe("PENDING");
    expect(fallback.reason).toBe("Camera glare prevented automated match");
    expect(fallback.requestedByUserId).toBe(officer.id);
    expect(fallback.requestedAt).toBeInstanceOf(Date);

    const auditRow = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.id, action: "facialVerification.manualFallback.requested", entityId: fallback.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.reason).toBe("Camera glare prevented automated match");
  });

  it("a supervisor approving records the approver, resolvedAt, and an audit event", async () => {
    const tenant = await createTenant();
    const officerRole = await createRole(tenant.id, "Gate Security Officer");
    const supervisorRole = await createRole(tenant.id, "Security Manager");
    const officer = await createUser({ tenantId: tenant.id, roleId: officerRole.id, email: `${crypto.randomUUID()}@example.test` });
    const supervisor = await createUser({ tenantId: tenant.id, roleId: supervisorRole.id, email: `${crypto.randomUUID()}@example.test` });
    const driver = await createDriver(tenant.id);

    const fallback = await requestManualFallback({
      tenantId: tenant.id,
      driverId: driver.id,
      requestedByUserId: officer.id,
      reason: "Face partially obscured by PPE",
    });

    const resolved = await resolveManualFallback({
      tenantId: tenant.id,
      fallbackId: fallback.id,
      approvedByUserId: supervisor.id,
      decision: "APPROVED",
    });

    expect(resolved?.status).toBe("APPROVED");
    expect(resolved?.approvedByUserId).toBe(supervisor.id);
    expect(resolved?.resolvedAt).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.id, action: "facialVerification.manualFallback.approved", entityId: fallback.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.userId).toBe(supervisor.id);
  });

  it("a supervisor denying records DENIED with an audit event", async () => {
    const tenant = await createTenant();
    const officerRole = await createRole(tenant.id, "Gate Security Officer");
    const supervisorRole = await createRole(tenant.id, "Security Manager");
    const officer = await createUser({ tenantId: tenant.id, roleId: officerRole.id, email: `${crypto.randomUUID()}@example.test` });
    const supervisor = await createUser({ tenantId: tenant.id, roleId: supervisorRole.id, email: `${crypto.randomUUID()}@example.test` });
    const driver = await createDriver(tenant.id);

    const fallback = await requestManualFallback({
      tenantId: tenant.id,
      driverId: driver.id,
      requestedByUserId: officer.id,
      reason: "Suspicious mismatch, escalating",
    });

    const resolved = await resolveManualFallback({
      tenantId: tenant.id,
      fallbackId: fallback.id,
      approvedByUserId: supervisor.id,
      decision: "DENIED",
    });

    expect(resolved?.status).toBe("DENIED");
    const auditRow = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.id, action: "facialVerification.manualFallback.denied", entityId: fallback.id },
    });
    expect(auditRow).not.toBeNull();
  });

  it("rejects the requester resolving their own fallback request (self-approval not allowed)", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const officer = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const driver = await createDriver(tenant.id);

    const fallback = await requestManualFallback({
      tenantId: tenant.id,
      driverId: driver.id,
      requestedByUserId: officer.id,
      reason: "Testing self-approval prevention",
    });

    await expect(
      resolveManualFallback({ tenantId: tenant.id, fallbackId: fallback.id, approvedByUserId: officer.id, decision: "APPROVED" }),
    ).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });
});
