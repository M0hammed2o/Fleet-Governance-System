import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
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
import { createTenant, createRole, createUser, createDriver } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

describe("media-asset-repository (Phase 4 — EVID-001..004)", () => {
  it("uploads a valid image and computes the checksum server-side, never trusting a client value blindly", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const data = Buffer.from("fictional test image bytes");
    const expectedChecksum = crypto.createHash("sha256").update(data).digest("hex");

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
    expect(asset.classification).toBe("RESTRICTED");
    expect(asset.fileSizeBytes).toBe(data.byteLength);
    expect(asset.storageKey).toContain(tenant.id);
  });

  it("rejects an unsupported content type (e.g. application/pdf) with a typed error, not a generic failure", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    await expect(
      uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "doc.pdf",
        contentType: "application/pdf",
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
        data: Buffer.from("bytes"),
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
        data: Buffer.from("real bytes"),
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
      const data = Buffer.from("identical retry bytes");

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
        data: Buffer.from("first content"),
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
          data: Buffer.from("different content entirely"),
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
        data: Buffer.from("tenant a bytes"),
        idempotencyKey: sharedKey,
      });
      const b = await uploadMediaAsset({
        tenantId: tenantB.id,
        actorUserId: actorB.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driverB.id,
        fileName: "b.jpg",
        contentType: "image/jpeg",
        data: Buffer.from("tenant b bytes"),
        idempotencyKey: sharedKey,
      });

      expect(a.id).not.toBe(b.id);
    });
  });

  describe("signed URL minting and serving (EVID-002 mandatory gate — no public permanent URL)", () => {
    it("mints a signed URL that, when parsed back through serveRawMediaAsset, returns the exact bytes originally uploaded", async () => {
      const tenant = await createTenant();
      const actor = await makeActor(tenant.id);
      const driver = await createDriver(tenant.id);
      const data = Buffer.from("the actual evidence bytes for this test");

      const asset = await uploadMediaAsset({
        tenantId: tenant.id,
        actorUserId: actor.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        fileName: "evidence.jpg",
        contentType: "image/jpeg",
        data,
        idempotencyKey: unique(),
      });

      const minted = await mintSignedUrlForMediaAsset(tenant.id, actor.id, asset.id, 300);
      expect(minted).not.toBeNull();
      const parsed = new URL(minted!.url, "http://localhost");
      const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
      const expiresAt = Number(parsed.searchParams.get("expires"));
      const signature = parsed.searchParams.get("sig")!;

      const { file } = await serveRawMediaAsset({ storageKey, expiresAt, signature, requestingTenantId: tenant.id });
      expect(file.data.equals(data)).toBe(true);
      expect(file.contentType).toBe("image/jpeg");

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
        data: Buffer.from("bytes"),
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
        data: Buffer.from("bytes"),
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
        data: Buffer.from("bytes"),
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
        data: Buffer.from("bytes"),
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
      data: Buffer.from("bytes"),
      idempotencyKey: unique(),
    });

    expect(await getMediaAssetInTenant(tenantB.id, asset.id)).toBeNull();
    expect(await getMediaAssetInTenant(tenantA.id, asset.id)).not.toBeNull();
  });
});
