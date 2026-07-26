import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import {
  initiatePresignedUpload,
  confirmPresignedUpload,
  cleanupFailedUploads,
  getStorageUsageForTenant,
  uploadMediaAsset,
  PendingUploadNotFoundError,
  UploadNeverCompletedError,
} from "@/lib/repositories/media-asset-repository";
import { LocalFilesystemStorageProvider } from "@/lib/storage/local-filesystem-provider";
import { R2CompatibleStorageProvider, R2NotConfiguredError } from "@/lib/storage/r2-compatible-provider";
import { compressImage, generateThumbnail, IMAGE_COMPRESSION_PROFILES } from "@/lib/storage/image-compression";
import { classifyContentType, maxBytesForKind, MEDIA_CATEGORY_RULES } from "@/lib/storage/media-categories";
import { createTenant, createRole, createUser, createDriver, fakeImageBytes } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

const localProvider = new LocalFilesystemStorageProvider();

describe("presigned direct-to-storage upload lifecycle (Phase 8B)", () => {
  it("initiate -> raw PUT -> confirm produces a READY, compressed MediaAsset", async () => {
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
    expect(mediaAsset.uploadStatus).toBe("PENDING");
    expect(mediaAsset.fileSizeBytes).toBe(0);

    // Simulate the client's direct PUT to the presigned URL by writing to the
    // reserved storage key directly (same thing the raw-upload route does
    // after verifying the signature — see src/app/api/media/raw-upload/route.ts).
    const parsed = new URL(uploadUrl, "http://localhost");
    const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
    const rawBytes = await fakeImageBytes(301);
    await localProvider.writeObject(storageKey, rawBytes, "image/jpeg");

    const confirmed = await confirmPresignedUpload(tenant.id, actor.id, mediaAsset.id);
    expect(confirmed.uploadStatus).toBe("READY");
    expect(confirmed.contentType).toBe("image/webp");
    expect(confirmed.compressionProfile).toBe("standard");
    expect(confirmed.checksumSha256).not.toBe("");

    const stored = await localProvider.read(confirmed.storageKey);
    expect(stored).not.toBeNull();
    const checksum = crypto.createHash("sha256").update(stored!.data).digest("hex");
    expect(checksum).toBe(confirmed.checksumSha256);
  });

  it("confirming before the object exists marks the row FAILED and throws a typed error", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const { mediaAsset } = await initiatePresignedUpload({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "never-uploaded.jpg",
      contentType: "image/jpeg",
      idempotencyKey: unique(),
    });

    await expect(confirmPresignedUpload(tenant.id, actor.id, mediaAsset.id)).rejects.toBeInstanceOf(UploadNeverCompletedError);

    const reloaded = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaAsset.id } });
    expect(reloaded.uploadStatus).toBe("FAILED");
  });

  it("rejects confirming a MediaAsset that isn't PENDING (already confirmed or never initiated)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "already-ready.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(302),
      idempotencyKey: unique(),
    });

    await expect(confirmPresignedUpload(tenant.id, actor.id, asset.id)).rejects.toBeInstanceOf(PendingUploadNotFoundError);
  });
});

describe("failed-upload cleanup (Phase 8B)", () => {
  it("removes a PENDING row older than the cleanup age and best-effort deletes any object at its storage key", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const { mediaAsset } = await initiatePresignedUpload({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "abandoned.jpg",
      contentType: "image/jpeg",
      idempotencyKey: unique(),
    });
    // Back-date createdAt so it's eligible for cleanup without waiting 24h for real.
    await prisma.mediaAsset.update({ where: { id: mediaAsset.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    const result = await cleanupFailedUploads(tenant.id, 24 * 60 * 60 * 1000);
    expect(result.cleanedCount).toBe(1);
    expect(await prisma.mediaAsset.findUnique({ where: { id: mediaAsset.id } })).toBeNull();
  });

  it("does not remove a PENDING row younger than the cleanup age", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const { mediaAsset } = await initiatePresignedUpload({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "still-in-progress.jpg",
      contentType: "image/jpeg",
      idempotencyKey: unique(),
    });

    const result = await cleanupFailedUploads(tenant.id, 24 * 60 * 60 * 1000);
    expect(result.cleanedCount).toBe(0);
    expect(await prisma.mediaAsset.findUnique({ where: { id: mediaAsset.id } })).not.toBeNull();
  });

  it("does not touch a READY row regardless of age", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "old-but-ready.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(303),
      idempotencyKey: unique(),
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });

    const result = await cleanupFailedUploads(tenant.id, 24 * 60 * 60 * 1000);
    expect(result.cleanedCount).toBe(0);
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
  });
});

describe("storage usage accounting (Phase 8B)", () => {
  it("aggregates READY bytes by category, excludes PENDING/FAILED from totals, and reports their counts separately", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const first = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(304),
      idempotencyKey: unique(),
      category: "DRIVER_PORTRAIT",
    });
    const second = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "damage.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(305),
      idempotencyKey: unique(),
      category: "DAMAGE_EVIDENCE",
    });
    await initiatePresignedUpload({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "pending.jpg",
      contentType: "image/jpeg",
      idempotencyKey: unique(),
    });

    const usage = await getStorageUsageForTenant(tenant.id);
    expect(usage.pendingUploadCount).toBe(1);
    expect(usage.failedUploadCount).toBe(0);
    const driverPortraitUsage = usage.byCategory.find((c) => c.category === "DRIVER_PORTRAIT");
    const damageUsage = usage.byCategory.find((c) => c.category === "DAMAGE_EVIDENCE");
    expect(driverPortraitUsage?.totalBytes).toBe(first.fileSizeBytes);
    expect(damageUsage?.totalBytes).toBe(second.fileSizeBytes);
    expect(usage.totalBytes).toBeGreaterThanOrEqual(first.fileSizeBytes + second.fileSizeBytes);
  });

  it("does not leak another tenant's storage usage", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const actorA = await makeActor(tenantA.id);
    const driverA = await createDriver(tenantA.id);

    await uploadMediaAsset({
      tenantId: tenantA.id,
      actorUserId: actorA.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driverA.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(306),
      idempotencyKey: unique(),
    });

    const usageB = await getStorageUsageForTenant(tenantB.id);
    expect(usageB.totalBytes).toBe(0);
    expect(usageB.byCategory).toHaveLength(0);
  });
});

describe("R2CompatibleStorageProvider (Phase 8B configuration boundary — no real Cloudflare account)", () => {
  it("is not configured by default in this environment (no R2_* env vars set anywhere in this repo)", () => {
    const provider = new R2CompatibleStorageProvider();
    expect(provider.isConfigured).toBe(false);
  });

  it("every method throws R2NotConfiguredError when unconfigured", async () => {
    const provider = new R2CompatibleStorageProvider(null);
    await expect(provider.store("tenant1", "OTHER_DOCUMENT", "f.jpg", Buffer.from("x"), "image/jpeg")).rejects.toBeInstanceOf(R2NotConfiguredError);
    await expect(provider.createPresignedUpload("tenant1", "OTHER_DOCUMENT", "f.jpg", "image/jpeg", 60)).rejects.toBeInstanceOf(R2NotConfiguredError);
    await expect(provider.confirmUpload("tenant1/x")).rejects.toBeInstanceOf(R2NotConfiguredError);
    await expect(provider.getSignedReadUrl("tenant1/x", 60)).rejects.toBeInstanceOf(R2NotConfiguredError);
    await expect(provider.read("tenant1/x")).rejects.toBeInstanceOf(R2NotConfiguredError);
    await expect(provider.delete("tenant1/x")).rejects.toBeInstanceOf(R2NotConfiguredError);
  });

  it("generates a validly-shaped presigned upload URL against a fake (non-real) config, without any real network call", async () => {
    // Presigned-URL generation is pure local SigV4 signing — this proves the
    // class is correctly wired for R2's endpoint shape, without ever
    // touching a real Cloudflare account (none exists for this project).
    const provider = new R2CompatibleStorageProvider({
      accountId: "fake-account-id",
      accessKeyId: "fake-access-key",
      secretAccessKey: "fake-secret-key",
      bucketName: "fake-bucket",
    });
    expect(provider.isConfigured).toBe(true);

    const presigned = await provider.createPresignedUpload("tenant1", "OTHER_DOCUMENT", "f.jpg", "image/jpeg", 900);
    expect(presigned.uploadUrl).toContain("fake-account-id.r2.cloudflarestorage.com");
    expect(presigned.uploadUrl).toContain("fake-bucket");
    expect(presigned.storageKey).toContain("tenant1/OTHER_DOCUMENT/");
    expect(presigned.method).toBe("PUT");

    const readUrl = await provider.getSignedReadUrl(presigned.storageKey, 300);
    expect(readUrl).toContain("fake-account-id.r2.cloudflarestorage.com");
  });
});

describe("media-categories (pure — lib/storage/media-categories.ts)", () => {
  it("classifies known content types and rejects unknown ones", () => {
    expect(classifyContentType("image/jpeg")).toBe("image");
    expect(classifyContentType("video/mp4")).toBe("video");
    expect(classifyContentType("application/pdf")).toBe("document");
    expect(classifyContentType("application/x-msdownload")).toBeNull();
  });

  it("every MediaCategory has a rule", () => {
    const categories: Array<keyof typeof MEDIA_CATEGORY_RULES> = [
      "DRIVER_PORTRAIT", "FACIAL_AUDIT", "VEHICLE_INSPECTION_PHOTO", "VEHICLE_INSPECTION_VIDEO",
      "DAMAGE_EVIDENCE", "CARGO_EVIDENCE", "DELIVERY_DOCUMENT", "INVESTIGATION_EVIDENCE",
      "GENERATED_REPORT", "OTHER_DOCUMENT",
    ];
    for (const category of categories) {
      expect(MEDIA_CATEGORY_RULES[category]).toBeDefined();
    }
  });

  it("DAMAGE_EVIDENCE and INVESTIGATION_EVIDENCE preserve originals and use the high-quality profile; everything else does not", () => {
    expect(MEDIA_CATEGORY_RULES.DAMAGE_EVIDENCE.preserveOriginalByDefault).toBe(true);
    expect(MEDIA_CATEGORY_RULES.INVESTIGATION_EVIDENCE.preserveOriginalByDefault).toBe(true);
    expect(MEDIA_CATEGORY_RULES.DRIVER_PORTRAIT.preserveOriginalByDefault).toBe(false);
    expect(MEDIA_CATEGORY_RULES.DAMAGE_EVIDENCE.imageCompressionProfile).toBe("high-quality");
    expect(MEDIA_CATEGORY_RULES.DRIVER_PORTRAIT.imageCompressionProfile).toBe("standard");
  });

  it("maxBytesForKind matches the documented D-013 limits", () => {
    expect(maxBytesForKind("image")).toBe(25 * 1024 * 1024);
    expect(maxBytesForKind("video")).toBe(200 * 1024 * 1024);
  });
});

describe("image-compression (pure — lib/storage/image-compression.ts)", () => {
  it("converts to WebP and never exceeds 1920px on the longest side", async () => {
    const large = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
    const result = await compressImage(large, "standard");
    expect(result.contentType).toBe("image/webp");
    expect(Math.max(result.widthPx, result.heightPx)).toBeLessThanOrEqual(1920);
    const metadata = await sharp(result.data).metadata();
    expect(metadata.format).toBe("webp");
  });

  it("never upscales an image smaller than the max dimension", async () => {
    const small = await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const result = await compressImage(small, "standard");
    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(50);
  });

  it("standard and high-quality profiles use different quality settings", () => {
    expect(IMAGE_COMPRESSION_PROFILES.standard.quality).toBeGreaterThanOrEqual(75);
    expect(IMAGE_COMPRESSION_PROFILES.standard.quality).toBeLessThanOrEqual(82);
    expect(IMAGE_COMPRESSION_PROFILES["high-quality"].quality).toBeGreaterThan(IMAGE_COMPRESSION_PROFILES.standard.quality);
  });

  it("generates a thumbnail no larger than 320px on the longest side", async () => {
    const image = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer();
    const thumb = await generateThumbnail(image);
    const metadata = await sharp(thumb).metadata();
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(320);
    expect(metadata.format).toBe("webp");
  });

  it("throws on genuinely undecodable input rather than silently passing it through", async () => {
    await expect(compressImage(Buffer.from("not an image at all"), "standard")).rejects.toThrow();
  });
});
