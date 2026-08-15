import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { enrolDriver } from "@/lib/repositories/facial-enrolment-repository";
import {
  approveBiometricTemplateDeletion,
  BiometricDeletionNotFoundError,
  BiometricDeletionSelfApprovalError,
  BiometricDeletionStateError,
  completeBiometricTemplateDeletion,
  requestBiometricTemplateDeletion,
} from "@/lib/repositories/biometric-deletion-repository";
import { createDriver, createRole, createTenant, createUser } from "./helpers/fixtures";

function captures(seed: number): number[][] {
  const base = Array.from({ length: 128 }, (_, index) => Math.sin(seed + index) * 5);
  return Array.from({ length: 3 }, (_, capture) => base.map((value, index) => value + Math.sin(capture * 7 + index) * 0.01));
}

async function setup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const requester = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const approver = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const driver = await createDriver(tenant.id);
  const template = await enrolDriver({ tenantId: tenant.id, actorUserId: requester.id, driverId: driver.id, captureDescriptors: captures(42), consentAcknowledged: true, synthetic: true });
  return { tenant, requester, approver, driver, template };
}

describe("Phase 17A biometric lifecycle", () => {
  it("requires independent approval and an elapsed recovery window", async () => {
    const value = await setup();
    const request = await requestBiometricTemplateDeletion({ tenantId: value.tenant.id, driverId: value.driver.id, actorUserId: value.requester.id, reason: "Synthetic lifecycle test" });
    await expect(approveBiometricTemplateDeletion({ tenantId: value.tenant.id, requestId: request.id, actorUserId: value.requester.id })).rejects.toBeInstanceOf(BiometricDeletionSelfApprovalError);
    const approvedAt = new Date("2026-08-01T00:00:00.000Z");
    const approved = await approveBiometricTemplateDeletion({ tenantId: value.tenant.id, requestId: request.id, actorUserId: value.approver.id, now: approvedAt });
    await expect(completeBiometricTemplateDeletion({ tenantId: value.tenant.id, requestId: request.id, actorUserId: value.approver.id, now: approvedAt })).rejects.toBeInstanceOf(BiometricDeletionStateError);
    const completed = await completeBiometricTemplateDeletion({ tenantId: value.tenant.id, requestId: request.id, actorUserId: value.approver.id, now: new Date("2026-09-01T00:00:00.000Z") });
    expect(approved.status).toBe("APPROVED");
    expect(completed.request.status).toBe("COMPLETED");
    expect(completed.template).toMatchObject({ status: "DELETED", templateCiphertext: null, templateIv: null, templateAuthTag: null, encryptionKeyId: null });
    expect(completed.template.materialDeletedAt).toBeInstanceOf(Date);
  });

  it("is idempotent while a deletion request is active", async () => {
    const value = await setup();
    const first = await requestBiometricTemplateDeletion({ tenantId: value.tenant.id, driverId: value.driver.id, actorUserId: value.requester.id, reason: "Synthetic first request" });
    const replay = await requestBiometricTemplateDeletion({ tenantId: value.tenant.id, driverId: value.driver.id, actorUserId: value.requester.id, reason: "Synthetic replay" });
    expect(replay.id).toBe(first.id);
  });

  it("does not expose another tenant's template lifecycle", async () => {
    const value = await setup();
    const foreignTenant = await createTenant();
    const foreignRole = await createRole(foreignTenant.id);
    const foreignActor = await createUser({ tenantId: foreignTenant.id, roleId: foreignRole.id, email: `${crypto.randomUUID()}@example.test` });
    await expect(requestBiometricTemplateDeletion({ tenantId: foreignTenant.id, driverId: value.driver.id, actorUserId: foreignActor.id, reason: "Cross-tenant attempt" })).rejects.toBeInstanceOf(BiometricDeletionNotFoundError);
    expect(await prisma.biometricTemplateDeletionRequest.count({ where: { templateId: value.template.id } })).toBe(0);
  });
});
