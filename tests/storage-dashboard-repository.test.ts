import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { uploadMediaAsset } from "@/lib/repositories/media-asset-repository";
import { ForbiddenError } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { getPlatformStorageDashboard, getCustomerStorageDashboard } from "@/lib/repositories/storage-dashboard-repository";
import { createTenant, createRole, createUser, createDriver, createVehicle, grantPermission, fakeImageBytes } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

async function makePlatformSession(permissions: Array<[string, string]> = []): Promise<AuthenticatedSession> {
  const platformTenant = await createTenant("Platform Style");
  const role = await createRole(platformTenant.id, "Platform Style Role");
  for (const [resource, action] of permissions) await grantPermission(role.id, resource, action);
  const user = await createUser({ tenantId: platformTenant.id, roleId: role.id, email: `${unique()}@example.test` });
  return { sessionId: "n/a", tenantId: platformTenant.id, userId: user.id, roleId: role.id, roleName: "Platform Style Role", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
}

describe("storage-dashboard-repository (Phase 8D)", () => {
  it("getPlatformStorageDashboard requires platformTenant:VIEW", async () => {
    const session = await makePlatformSession([]);
    await expect(getPlatformStorageDashboard(session)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("getPlatformStorageDashboard excludes the canonical platform tenant and includes a real customer tenant with correct aggregates", async () => {
    await prisma.tenant.upsert({ where: { slug: "platform" }, update: {}, create: { name: "Platform", slug: "platform" } });
    const session = await makePlatformSession([["platformTenant", "VIEW"]]);

    const customer = await createTenant("Storage Dashboard Customer");
    const actor = await makeActor(customer.id);
    const driver = await createDriver(customer.id);
    await createVehicle(customer.id);
    await uploadMediaAsset({
      tenantId: customer.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(501),
      idempotencyKey: unique(),
      category: "CARGO_EVIDENCE",
    });

    const rows = await getPlatformStorageDashboard(session);
    expect(rows.some((r) => r.tenant.slug === "platform")).toBe(false);

    const row = rows.find((r) => r.tenant.id === customer.id);
    expect(row).toBeDefined();
    expect(row!.activeVehicleCount).toBe(1);
    expect(row!.currentStorageBytes).toBeGreaterThan(0);
    expect(row!.storageByCategory.some((c) => c.category === "CARGO_EVIDENCE")).toBe(true);
  });

  it("counts evidence under hold, open export requests, and pending deletion requests correctly", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(502),
      idempotencyKey: unique(),
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { legalHold: true } });

    const row = await getCustomerStorageDashboard(tenant.id);
    expect(row!.evidenceUnderHoldCount).toBe(1);
  });

  it("failed uploads are counted separately from READY storage totals", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(503),
      idempotencyKey: unique(),
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { uploadStatus: "FAILED" } });

    const row = await getCustomerStorageDashboard(tenant.id);
    expect(row!.failedUploadCount).toBe(1);
    expect(row!.currentStorageBytes).toBe(0); // FAILED rows don't count toward billable/current storage
  });

  it("does not leak another tenant's storage data into the customer dashboard", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const actorA = await makeActor(tenantA.id);
    const driverA = await createDriver(tenantA.id);
    await uploadMediaAsset({
      tenantId: tenantA.id,
      actorUserId: actorA.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driverA.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(504),
      idempotencyKey: unique(),
    });

    const rowB = await getCustomerStorageDashboard(tenantB.id);
    expect(rowB!.currentStorageBytes).toBe(0);
    expect(rowB!.storageByCategory).toHaveLength(0);
  });

  it("excludes a permanently-deleted asset's bytes from current storage (its binary is actually gone)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(505),
      idempotencyKey: unique(),
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { retentionStatus: "DELETED", binaryDeletedAt: new Date() } });

    const row = await getCustomerStorageDashboard(tenant.id);
    expect(row!.currentStorageBytes).toBe(0);
    expect(row!.storageByCategory).toHaveLength(0);
  });

  it("counts archived bytes separately from current storage, never both", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(506),
      idempotencyKey: unique(),
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { retentionStatus: "ARCHIVED" } });

    const row = await getCustomerStorageDashboard(tenant.id);
    expect(row!.archivedBytes).toBe(asset.fileSizeBytes);
    expect(row!.currentStorageBytes).toBe(0);
  });

  it("returns null for a tenant id that does not exist", async () => {
    const row = await getCustomerStorageDashboard("nonexistent-tenant-id");
    expect(row).toBeNull();
  });
});
