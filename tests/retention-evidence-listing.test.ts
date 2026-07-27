import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { listEvidenceInTenant } from "@/lib/repositories/retention-repository";
import { createTenant, createRole, createUser, createDriver } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

async function createEvidence(
  tenantId: string,
  actorUserId: string,
  driverId: string,
  overrides: Partial<{
    category: "DRIVER_PORTRAIT" | "OTHER_DOCUMENT";
    legalHold: boolean;
    investigationHold: boolean;
    scheduledDeletionAt: Date | null;
    retentionStatus: "ACTIVE" | "ARCHIVED";
  }> = {},
) {
  return prisma.mediaAsset.create({
    data: {
      tenantId,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driverId,
      capturedByUserId: actorUserId,
      capturedAt: new Date(),
      fileName: "evidence.jpg",
      contentType: "image/webp",
      fileSizeBytes: 2048,
      storageKey: `evidence/${unique()}`,
      checksumSha256: crypto.randomBytes(32).toString("hex"),
      idempotencyKey: unique(),
      category: overrides.category ?? "OTHER_DOCUMENT",
      uploadStatus: "READY",
      retentionStatus: overrides.retentionStatus ?? "ACTIVE",
      legalHold: overrides.legalHold ?? false,
      investigationHold: overrides.investigationHold ?? false,
      scheduledDeletionAt: overrides.scheduledDeletionAt ?? null,
    },
  });
}

describe("8E-005: listEvidenceInTenant (retention management UI browsing surface)", () => {
  it("never includes storageKey, checksumSha256, or thumbnailStorageKey in its returned shape", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await createEvidence(tenant.id, actor.id, driver.id);

    const list = await listEvidenceInTenant(tenant.id);
    expect(list).toHaveLength(1);
    const keys = Object.keys(list[0]);
    expect(keys).not.toContain("storageKey");
    expect(keys).not.toContain("checksumSha256");
    expect(keys).not.toContain("thumbnailStorageKey");
    expect(keys).not.toContain("originalStorageKey");
  });

  it("filters by category", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await createEvidence(tenant.id, actor.id, driver.id, { category: "DRIVER_PORTRAIT" });
    await createEvidence(tenant.id, actor.id, driver.id, { category: "OTHER_DOCUMENT" });

    const portraits = await listEvidenceInTenant(tenant.id, { category: "DRIVER_PORTRAIT" });
    expect(portraits).toHaveLength(1);
    expect(portraits[0].category).toBe("DRIVER_PORTRAIT");
  });

  it("onlyHeld returns only assets under legal or investigation hold", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const held = await createEvidence(tenant.id, actor.id, driver.id, { legalHold: true });
    await createEvidence(tenant.id, actor.id, driver.id, {});

    const list = await listEvidenceInTenant(tenant.id, { onlyHeld: true });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(held.id);
  });

  it("onlyApproachingExpiry returns only ACTIVE assets within the next 90 days", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const now = new Date("2026-05-01T00:00:00Z");
    const soon = await createEvidence(tenant.id, actor.id, driver.id, { scheduledDeletionAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000) });
    await createEvidence(tenant.id, actor.id, driver.id, { scheduledDeletionAt: new Date(now.getTime() + 200 * 24 * 60 * 60 * 1000) });
    await createEvidence(tenant.id, actor.id, driver.id, { scheduledDeletionAt: null });

    const list = await listEvidenceInTenant(tenant.id, { onlyApproachingExpiry: true }, now);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(soon.id);
  });

  it("excludes evidence whose binary has already been permanently deleted", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await createEvidence(tenant.id, actor.id, driver.id, {});
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { binaryDeletedAt: new Date(), retentionStatus: "DELETED" } });

    const list = await listEvidenceInTenant(tenant.id);
    expect(list).toHaveLength(0);
  });

  it("never returns another tenant's evidence", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorA = await makeActor(tenantA.id);
    const driverA = await createDriver(tenantA.id);
    const actorB = await makeActor(tenantB.id);
    const driverB = await createDriver(tenantB.id);
    await createEvidence(tenantA.id, actorA.id, driverA.id, {});
    await createEvidence(tenantB.id, actorB.id, driverB.id, {});

    const list = await listEvidenceInTenant(tenantA.id);
    expect(list).toHaveLength(1);
  });
});
