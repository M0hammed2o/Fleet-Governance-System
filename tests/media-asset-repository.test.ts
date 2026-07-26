import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import {
  uploadMediaAsset,
  getMediaAssetInTenant,
  mintSignedUrlForMediaAsset,
  serveRawMediaAsset,
  InvalidFileTypeError,
  EmptyFileError,
  FileTooLargeError,
  ChecksumMismatchError,
  IdempotencyKeyConflictError,
  MediaOwnerNotFoundError,
  InvalidOrExpiredSignedUrlError,
  MAX_IMAGE_BYTES,
} from "@/lib/repositories/media-asset-repository";
import { compressImage } from "@/lib/storage/image-compression";
import { createTenant, createRole, createUser, createDriver, fakeImageBytes } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

describe("media-asset-repository (Phase 4 — EVID-001..004, Phase 8B compression pipeline)", () => {
  it("uploads a valid image, compresses it, and computes the checksum over the final (compressed) bytes — never the client's original bytes, never trusting a client checksum blindly", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const data = await fakeImageBytes(1);
    const expectedFinal = await compressImage(data, "standard");
    const expectedChecksum = crypto.createHash("sha256").update(expectedFinal.data).digest("hex");

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      data,
      idempotencyKey: unique(),
    });

    expect(asset.checksumSha256).toBe(expectedChecksum);
    expect(asset.checksumSha256).not.toBe(crypto.createHash("sha256").update(data).digest("hex")); // proves it's the final bytes, not the original
    expect(asset.contentType).toBe("image/webp");
    expect(asset.classification).toBe("RESTRICTED");
    expect(asset.fileSizeBytes).toBe(expectedFinal.data.byteLength);
    expect(asset.storageKey).toContain(tenant.id);
    expect(asset.category).toBe("OTHER_DOCUMENT"); // no category passed — defaults
    expect(asset.compressionProfile).toBe("standard");
    expect(asset.uploadStatus).toBe("READY");
  });

  it("generates a thumbnail for an uploaded image", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

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

    expect(asset.thumbnailStorageKey).not.toBeNull();
    const file = await readStorageObjectDirectly(asset.thumbnailStorageKey!);
    const metadata = await sharp(file.data).metadata();
    expect(metadata.format).toBe("webp");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(320);
  });

  it("preserves the original alongside the compressed copy for a category flagged for high-quality/original retention (DAMAGE_EVIDENCE)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const data = await fakeImageBytes(3);

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "damage.jpg",
      contentType: "image/jpeg",
      data,
      idempotencyKey: unique(),
      category: "DAMAGE_EVIDENCE",
    });

    expect(asset.originalStorageKey).not.toBeNull();
    expect(asset.compressionProfile).toBe("high-quality");
    const file = await readStorageObjectDirectly(asset.originalStorageKey!);
    expect(file.data.equals(data)).toBe(true); // the original, untouched
  });

  it("does not preserve an original for a category with no such policy (OTHER_DOCUMENT)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(4),
      idempotencyKey: unique(),
    });

    expect(asset.originalStorageKey).toBeNull();
  });

  it("records capture metadata alongside the file", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driver.id,
      fileName: "portrait.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(5),
      idempotencyKey: unique(),
      captureMetadata: { device: "iPad Air", originalWidthPx: 4032, originalHeightPx: 3024 },
    });

    const reloaded = await getMediaAssetInTenant(tenant.id, asset.id);
    expect(reloaded?.captureMetadata).toMatchObject({ device: "iPad Air", originalWidthPx: 4032 });
  });

  it("rejects an unsupported content type (e.g. text/plain) with a typed error, not a generic failure", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(
      uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "doc.txt",
        contentType: "text/plain",
        data: Buffer.from("not an image"),
        idempotencyKey: unique(),
      }),
    ).rejects.toBeInstanceOf(InvalidFileTypeError);
  });

  it("rejects an empty file", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(
      uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "empty.jpg",
        contentType: "image/jpeg",
        data: Buffer.alloc(0),
        idempotencyKey: unique(),
      }),
    ).rejects.toBeInstanceOf(EmptyFileError);
  });

  it("rejects an image over the 25MB limit", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(
      uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "huge.jpg",
        contentType: "image/jpeg",
        data: Buffer.alloc(MAX_IMAGE_BYTES + 1),
        idempotencyKey: unique(),
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it("rejects when the owning record does not exist in the caller's tenant (guards against a guessed/foreign ownerId)", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const actorA = await makeActor(tenantA.id);
    const driverB = await createDriver(tenantB.id);

    await expect(
      uploadMediaAsset({
        tenantId: tenantA.id,
        actorUserId: actorA.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driverB.id, // belongs to a different tenant
        fileName: "portrait.jpg",
        contentType: "image/jpeg",
        data: await fakeImageBytes(6),
        idempotencyKey: unique(),
      }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
  });

  it("rejects when a client-supplied checksum doesn't match the server-computed one (never trusts it blindly)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(
      uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "portrait.jpg",
        contentType: "image/jpeg",
        data: await fakeImageBytes(7),
        idempotencyKey: unique(),
        clientChecksumSha256: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);
  });

  describe("upload retry without duplication (EVID-003 mandatory gate)", () => {
    it("uploading the same file with the same idempotency key twice results in exactly one MediaAsset row, returning the existing record on the second call", async () => {
      const tenant = await createTenant();
      const actor = await makeActor(tenant.id);
      const driver = await createDriver(tenant.id);
      const idempotencyKey = unique();
      const data = await fakeImageBytes(8);

      const first = await uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "portrait.jpg",
        contentType: "image/jpeg",
        data,
        idempotencyKey,
      });
      const second = await uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "portrait.jpg",
        contentType: "image/jpeg",
        data,
        idempotencyKey,
      });

      expect(second.id).toBe(first.id);
      const count = await prisma.mediaAsset.count({ where: { tenantId: tenant.id, idempotencyKey } });
      expect(count).toBe(1);
    });

    it("rejects a retry that reuses the same idempotency key with genuinely different content", async () => {
      const tenant = await createTenant();
      const actor = await makeActor(tenant.id);
      const driver = await createDriver(tenant.id);
      const idempotencyKey = unique();

      await uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "portrait.jpg",
        contentType: "image/jpeg",
        data: await fakeImageBytes(9),
        idempotencyKey,
      });

      await expect(
        uploadMediaAsset({
          tenantId: tenant.id,
          actorUserId: actor.id,
          ownerType: "DRIVER_PORTRAIT",
          ownerId: driver.id,
          fileName: "portrait.jpg",
          contentType: "image/jpeg",
          data: await fakeImageBytes(10),
          idempotencyKey,
        }),
      ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);

      const count = await prisma.mediaAsset.count({ where: { tenantId: tenant.id, idempotencyKey } });
      expect(count).toBe(1);
    });

    it("allows the same idempotency key to be reused across two different tenants (uniqueness is per-tenant)", async () => {
      const tenantA = await createTenant("Tenant A");
      const tenantB = await createTenant("Tenant B");
      const actorA = await makeActor(tenantA.id);
      const actorB = await makeActor(tenantB.id);
      const driverA = await createDriver(tenantA.id);
      const driverB = await createDriver(tenantB.id);
      const sharedKey = unique();

      const a = await uploadMediaAsset({
        tenantId: tenantA.id,
        actorUserId: actorA.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driverA.id,
        fileName: "a.jpg",
        contentType: "image/jpeg",
        data: await fakeImageBytes(11),
        idempotencyKey: sharedKey,
      });
      const b = await uploadMediaAsset({
        tenantId: tenantB.id,
        actorUserId: actorB.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driverB.id,
        fileName: "b.jpg",
        contentType: "image/jpeg",
        data: await fakeImageBytes(12),
        idempotencyKey: sharedKey,
      });

      expect(a.id).not.toBe(b.id);
    });
  });

  describe("signed URL minting and serving (EVID-002 mandatory gate — no public permanent URL)", () => {
    it("mints a signed URL that, when parsed back through serveRawMediaAsset, returns the exact (final, compressed) bytes actually stored, self-consistent with the recorded checksum", async () => {
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
        data: await fakeImageBytes(13),
        idempotencyKey: unique(),
      });

      const minted = await mintSignedUrlForMediaAsset(tenant.id, actor.id, asset.id, 300);
      expect(minted).not.toBeNull();
      const parsed = new URL(minted!.url, "http://localhost");
      const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
      const expiresAt = Number(parsed.searchParams.get("expires"));
      const signature = parsed.searchParams.get("sig")!;

      const { file } = await serveRawMediaAsset({ storageKey, expiresAt, signature, requestingTenantId: tenant.id });
      expect(crypto.createHash("sha256").update(file.data).digest("hex")).toBe(asset.checksumSha256);
      expect(file.contentType).toBe("image/webp");
      const metadata = await sharp(file.data).metadata();
      expect(metadata.format).toBe("webp"); // genuinely decodable, not just a byte-count match

      // Audit-on-read: mint time is when read access is granted (see DECISIONS.md).
      const auditRows = await prisma.auditLog.findMany({
        where: { tenantId: tenant.id, entityType: "MediaAsset", entityId: asset.id, action: "mediaAsset.readAccessGranted" },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects an expired signed URL, distinct from an invalid signature", async () => {
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
        data: await fakeImageBytes(14),
        idempotencyKey: unique(),
      });

      // Expires immediately (0s) — sleep 1.1s to guarantee it's in the past.
      const minted = await mintSignedUrlForMediaAsset(tenant.id, actor.id, asset.id, 0);
      await new Promise((r) => setTimeout(r, 1100));
      const parsed = new URL(minted!.url, "http://localhost");
      const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
      const expiresAt = Number(parsed.searchParams.get("expires"));
      const signature = parsed.searchParams.get("sig")!;

      await expect(
        serveRawMediaAsset({ storageKey, expiresAt, signature, requestingTenantId: tenant.id }),
      ).rejects.toMatchObject({ reason: "expired" });
    });

    it("rejects a tampered signature", async () => {
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
        data: await fakeImageBytes(15),
        idempotencyKey: unique(),
      });
      const minted = await mintSignedUrlForMediaAsset(tenant.id, actor.id, asset.id, 300);
      const parsed = new URL(minted!.url, "http://localhost");
      const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
      const expiresAt = Number(parsed.searchParams.get("expires"));

      await expect(
        serveRawMediaAsset({ storageKey, expiresAt, signature: "0".repeat(64), requestingTenantId: tenant.id }),
      ).rejects.toBeInstanceOf(InvalidOrExpiredSignedUrlError);
    });

    it("mintSignedUrlForMediaAsset returns null for a MediaAsset belonging to a different tenant (cannot mint a URL for another tenant's evidence)", async () => {
      const tenantA = await createTenant("Tenant A");
      const tenantB = await createTenant("Tenant B");
      const actorA = await makeActor(tenantA.id);
      const actorB = await makeActor(tenantB.id);
      const driverA = await createDriver(tenantA.id);

      const asset = await uploadMediaAsset({
        tenantId: tenantA.id,
        actorUserId: actorA.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driverA.id,
        fileName: "evidence.jpg",
        contentType: "image/jpeg",
        data: await fakeImageBytes(16),
        idempotencyKey: unique(),
      });

      const mintedForWrongTenant = await mintSignedUrlForMediaAsset(tenantB.id, actorB.id, asset.id, 300);
      expect(mintedForWrongTenant).toBeNull();
    });

    it("rejects serving a valid signature+expiry when the requesting session's tenant does not match the asset's tenant (defense in depth beyond the signature alone)", async () => {
      const tenantA = await createTenant("Tenant A");
      const tenantB = await createTenant("Tenant B");
      const actorA = await makeActor(tenantA.id);
      const driverA = await createDriver(tenantA.id);

      const asset = await uploadMediaAsset({
        tenantId: tenantA.id,
        actorUserId: actorA.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driverA.id,
        fileName: "evidence.jpg",
        contentType: "image/jpeg",
        data: await fakeImageBytes(17),
        idempotencyKey: unique(),
      });
      const minted = await mintSignedUrlForMediaAsset(tenantA.id, actorA.id, asset.id, 300);
      const parsed = new URL(minted!.url, "http://localhost");
      const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
      const expiresAt = Number(parsed.searchParams.get("expires"));
      const signature = parsed.searchParams.get("sig")!;

      // The signature itself is genuinely valid (correctly minted for tenantA);
      // only the requesting tenant differs — must still be rejected.
      await expect(
        serveRawMediaAsset({ storageKey, expiresAt, signature, requestingTenantId: tenantB.id }),
      ).rejects.toBeInstanceOf(InvalidOrExpiredSignedUrlError);
    });
  });

  it("getMediaAssetInTenant returns null for an asset id that belongs to a different tenant", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const actorA = await makeActor(tenantA.id);
    const driverA = await createDriver(tenantA.id);

    const asset = await uploadMediaAsset({
      tenantId: tenantA.id,
      actorUserId: actorA.id,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driverA.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(18),
      idempotencyKey: unique(),
    });

    expect(await getMediaAssetInTenant(tenantB.id, asset.id)).toBeNull();
    expect(await getMediaAssetInTenant(tenantA.id, asset.id)).not.toBeNull();
  });
});

/**
 * Reads a non-primary storage key (thumbnail/original) directly off the
 * local dev filesystem — `serveRawMediaAsset()`/`mintSignedUrlForMediaAsset()`
 * only ever look up a MediaAsset by its *primary* `storageKey` column, so
 * they can't serve a thumbnail/original key; this bypasses the HTTP-facing
 * signed-URL path entirely and asserts directly against the storage layer,
 * which is all these tests need.
 */
async function readStorageObjectDirectly(storageKey: string) {
  const { LocalFilesystemStorageProvider } = await import("@/lib/storage/local-filesystem-provider");
  const file = await new LocalFilesystemStorageProvider().read(storageKey);
  if (!file) throw new Error(`Expected a stored object at ${storageKey}`);
  return file;
}
