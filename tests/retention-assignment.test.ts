import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { uploadMediaAsset, initiatePresignedUpload, confirmPresignedUpload } from "@/lib/repositories/media-asset-repository";
import { upsertRetentionPolicy, DEFAULT_RETENTION_DAYS } from "@/lib/repositories/retention-policy-repository";
import { backfillMissingScheduledDeletionAt } from "@/lib/repositories/retention-repository";
import { LocalFilesystemStorageProvider } from "@/lib/storage/local-filesystem-provider";
import { createTenant, createRole, createUser, createDriver, fakeImageBytes } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

const localProvider = new LocalFilesystemStorageProvider();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Directly creates a MediaAsset row bypassing uploadMediaAsset() — simulates data that existed before automatic assignment (8E-001) shipped. */
async function createLegacyAsset(
  tenantId: string,
  actorUserId: string,
  driverId: string,
  overrides: Partial<{
    capturedAt: Date;
    scheduledDeletionAt: Date | null;
    retentionStatus: "ACTIVE" | "ARCHIVED" | "PENDING_DELETION" | "DELETED";
    legalHold: boolean;
    investigationHold: boolean;
    retentionExtendedAt: Date | null;
    category: "DRIVER_PORTRAIT" | "OTHER_DOCUMENT";
  }> = {},
) {
  return prisma.mediaAsset.create({
    data: {
      tenantId,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driverId,
      capturedByUserId: actorUserId,
      capturedAt: overrides.capturedAt ?? new Date("2025-01-01T00:00:00Z"),
      fileName: "legacy.jpg",
      contentType: "image/webp",
      fileSizeBytes: 100,
      storageKey: `legacy/${unique()}`,
      checksumSha256: crypto.randomBytes(32).toString("hex"),
      idempotencyKey: unique(),
      category: overrides.category ?? "OTHER_DOCUMENT",
      uploadStatus: "READY",
      retentionStatus: overrides.retentionStatus ?? "ACTIVE",
      scheduledDeletionAt: overrides.scheduledDeletionAt === undefined ? null : overrides.scheduledDeletionAt,
      legalHold: overrides.legalHold ?? false,
      investigationHold: overrides.investigationHold ?? false,
      retentionExtendedAt: overrides.retentionExtendedAt ?? null,
    },
  });
}

describe("8E-001: automatic retention assignment on upload", () => {
  it("a direct upload with no tenant RetentionPolicy override gets scheduledDeletionAt = capturedAt + the 365-day default", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const before = new Date();
    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(1),
      idempotencyKey: unique(),
      category: "DRIVER_PORTRAIT",
    });

    expect(asset.scheduledDeletionAt).not.toBeNull();
    const expected = new Date(asset.capturedAt.getTime() + DEFAULT_RETENTION_DAYS * MS_PER_DAY);
    expect(asset.scheduledDeletionAt!.getTime()).toBe(expected.getTime());
    expect(asset.capturedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("a direct upload in a category with a tenant-specific RetentionPolicy override uses that policy's retentionDays, not the default", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await upsertRetentionPolicy({ tenantId: tenant.id, actorUserId: actor.id, category: "DRIVER_PORTRAIT", retentionDays: 90 });

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(2),
      idempotencyKey: unique(),
      category: "DRIVER_PORTRAIT",
    });

    const expected = new Date(asset.capturedAt.getTime() + 90 * MS_PER_DAY);
    expect(asset.scheduledDeletionAt!.getTime()).toBe(expected.getTime());
  });

  it("the presigned-upload path also assigns scheduledDeletionAt when it transitions PENDING -> READY", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const { mediaAsset, uploadUrl } = await initiatePresignedUpload({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      idempotencyKey: unique(),
      category: "DRIVER_PORTRAIT",
    });
    expect(mediaAsset.scheduledDeletionAt).toBeNull();

    const parsed = new URL(uploadUrl, "http://localhost");
    const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
    await localProvider.writeObject(storageKey, await fakeImageBytes(3), "image/jpeg");

    const confirmed = await confirmPresignedUpload(tenant.id, actor.id, mediaAsset.id);
    expect(confirmed.scheduledDeletionAt).not.toBeNull();
    const expected = new Date(confirmed.capturedAt.getTime() + DEFAULT_RETENTION_DAYS * MS_PER_DAY);
    expect(confirmed.scheduledDeletionAt!.getTime()).toBe(expected.getTime());
  });
});

describe("8E-001: backfillMissingScheduledDeletionAt", () => {
  it("assigns scheduledDeletionAt to an ordinary ACTIVE legacy asset using the 365-day default", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const capturedAt = new Date("2025-06-01T00:00:00Z");
    const legacy = await createLegacyAsset(tenant.id, actor.id, driver.id, { capturedAt });

    const result = await backfillMissingScheduledDeletionAt(tenant.id);
    expect(result.assignedCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(updated.scheduledDeletionAt!.getTime()).toBe(capturedAt.getTime() + DEFAULT_RETENTION_DAYS * MS_PER_DAY);
  });

  it("assigns using the tenant's category-specific RetentionPolicy override when one exists", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await upsertRetentionPolicy({ tenantId: tenant.id, actorUserId: actor.id, category: "DRIVER_PORTRAIT", retentionDays: 45 });
    const capturedAt = new Date("2025-03-01T00:00:00Z");
    const legacy = await createLegacyAsset(tenant.id, actor.id, driver.id, { capturedAt, category: "DRIVER_PORTRAIT" });

    await backfillMissingScheduledDeletionAt(tenant.id);

    const updated = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(updated.scheduledDeletionAt!.getTime()).toBe(capturedAt.getTime() + 45 * MS_PER_DAY);
  });

  it("never assigns scheduledDeletionAt to an already-ARCHIVED asset", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const legacy = await createLegacyAsset(tenant.id, actor.id, driver.id, { retentionStatus: "ARCHIVED" });

    await backfillMissingScheduledDeletionAt(tenant.id);

    const updated = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(updated.scheduledDeletionAt).toBeNull();
  });

  it("never assigns scheduledDeletionAt to a permanently-deleted metadata record (retentionStatus DELETED)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const legacy = await createLegacyAsset(tenant.id, actor.id, driver.id, { retentionStatus: "DELETED" });

    await backfillMissingScheduledDeletionAt(tenant.id);

    const updated = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(updated.scheduledDeletionAt).toBeNull();
  });

  it("never assigns scheduledDeletionAt to an asset under legal hold or investigation hold", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const legalHeld = await createLegacyAsset(tenant.id, actor.id, driver.id, { legalHold: true });
    const investigationHeld = await createLegacyAsset(tenant.id, actor.id, driver.id, { investigationHold: true });

    await backfillMissingScheduledDeletionAt(tenant.id);

    const updatedLegal = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: legalHeld.id } });
    const updatedInvestigation = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: investigationHeld.id } });
    expect(updatedLegal.scheduledDeletionAt).toBeNull();
    expect(updatedInvestigation.scheduledDeletionAt).toBeNull();
  });

  it("never overwrites an asset with a valid explicit retention extension (retentionExtendedAt set)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    // scheduledDeletionAt left null here to prove the exclusion is driven by
    // retentionExtendedAt itself, not merely "already has a value".
    const legacy = await createLegacyAsset(tenant.id, actor.id, driver.id, { retentionExtendedAt: new Date() });

    await backfillMissingScheduledDeletionAt(tenant.id);

    const updated = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(updated.scheduledDeletionAt).toBeNull();
  });

  it("is idempotent — re-running after a successful backfill assigns nothing further", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await createLegacyAsset(tenant.id, actor.id, driver.id, {});

    const first = await backfillMissingScheduledDeletionAt(tenant.id);
    expect(first.assignedCount).toBeGreaterThanOrEqual(1);

    const second = await backfillMissingScheduledDeletionAt(tenant.id);
    expect(second.assignedCount).toBe(0);
  });
});
