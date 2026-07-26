import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { LocalFilesystemStorageProvider } from "@/lib/storage/local-filesystem-provider";
import { R2CompatibleStorageProvider } from "@/lib/storage/r2-compatible-provider";
import { verifyResourceAccess } from "@/lib/storage/signed-url";
import type { ObjectStorageProvider } from "@/lib/storage/provider";
import { classifyContentType, maxBytesForKind, MEDIA_CATEGORY_RULES } from "@/lib/storage/media-categories";
import { compressImage, generateThumbnail } from "@/lib/storage/image-compression";
import { PassthroughVideoCompressionProvider } from "@/lib/storage/video-compression";
import type { MediaAssetOwnerType, MediaCategory, Prisma } from "@/generated/prisma/client";

export { classifyContentType, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/lib/storage/media-categories";

function createDefaultProvider(): { provider: ObjectStorageProvider; name: string } {
  const name = process.env.STORAGE_PROVIDER === "r2" ? "r2" : "local";
  return name === "r2" ? { provider: new R2CompatibleStorageProvider(), name } : { provider: new LocalFilesystemStorageProvider(), name };
}
const { provider: defaultProvider, name: defaultProviderName } = createDefaultProvider();
const videoCompressionProvider = new PassthroughVideoCompressionProvider();

/** Shared default provider selection — reused by retention-repository.ts so both files route through the same STORAGE_PROVIDER env-driven choice. */
export function getDefaultObjectStorageProvider(): ObjectStorageProvider {
  return defaultProvider;
}

// Short-lived on purpose (SECURITY_AND_POPIA.md "short-lived signed URLs") —
// long enough for a browser to actually load an <img>/<video> src in one
// round trip, short enough that a leaked URL (e.g. copy-pasted, cached
// proxy log) stops working quickly. See DECISIONS.md for the exact value
// chosen and why.
export const SIGNED_URL_DEFAULT_EXPIRY_SECONDS = 300;

// How long a presigned upload URL stays valid before the client must use it.
export const PRESIGNED_UPLOAD_EXPIRY_SECONDS = 900; // 15 minutes

// A PENDING/FAILED row older than this is orphaned — the client either never
// used the presigned URL or the upload never completed — eligible for
// cleanupFailedUploads() (Phase 8B "failed-upload cleanup").
export const FAILED_UPLOAD_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

// --- Typed errors ------------------------------------------------------------
// Every precondition/business-rule violation below is a typed class, not a
// plain Error — this codebase has hit the "untyped Error surfaces as a
// generic 500 instead of a 4xx" bug three times already (BUG-001/002/003,
// see KNOWN_BUGS.md). Every route that calls into this file explicitly
// catches each of these and maps it to the correct status code.

export class InvalidFileTypeError extends Error {
  constructor(contentType: string) {
    super(`Unsupported file type "${contentType}".`);
    this.name = "InvalidFileTypeError";
  }
}

export class EmptyFileError extends Error {
  constructor() {
    super("The uploaded file is empty.");
    this.name = "EmptyFileError";
  }
}

export class FileTooLargeError extends Error {
  constructor(kind: "image" | "video" | "document", actualBytes: number, maxBytes: number) {
    super(
      `File exceeds the maximum allowed size for ${kind} content ` +
        `(${Math.round(maxBytes / (1024 * 1024))}MB); received ${Math.ceil(actualBytes / (1024 * 1024))}MB.`,
    );
    this.name = "FileTooLargeError";
  }
}

export class ChecksumMismatchError extends Error {
  constructor() {
    super("The uploaded file's server-computed checksum does not match the checksum supplied by the client.");
    this.name = "ChecksumMismatchError";
  }
}

/**
 * Same idempotency key was already used for genuinely different content —
 * distinct from a normal retry (same key, same content, which is a
 * no-op success, not an error — see uploadMediaAsset()).
 */
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("This idempotency key was already used for a different upload. Use a new key for different content.");
    this.name = "IdempotencyKeyConflictError";
  }
}

export class MediaOwnerNotFoundError extends Error {
  constructor(ownerType: string, ownerId: string) {
    super(`No ${ownerType} record with id "${ownerId}" was found in your company.`);
    this.name = "MediaOwnerNotFoundError";
  }
}

export class InvalidOrExpiredSignedUrlError extends Error {
  reason: "expired" | "invalid_signature";
  constructor(reason: "expired" | "invalid_signature") {
    super(reason === "expired" ? "This signed media URL has expired." : "This signed media URL is invalid.");
    this.name = "InvalidOrExpiredSignedUrlError";
    this.reason = reason;
  }
}

export class MediaAssetNotFoundForStorageKeyError extends Error {
  constructor() {
    super("No media asset was found for this storage key.");
    this.name = "MediaAssetNotFoundForStorageKeyError";
  }
}

export class MediaProcessingError extends Error {
  constructor(reason: string) {
    super(`Could not process the uploaded file: ${reason}`);
    this.name = "MediaProcessingError";
  }
}

export class PendingUploadNotFoundError extends Error {
  constructor() {
    super("No pending upload was found for this media asset (already confirmed, or never initiated).");
    this.name = "PendingUploadNotFoundError";
  }
}

export class UploadNeverCompletedError extends Error {
  constructor() {
    super("The presigned upload was never completed — no object exists at the reserved storage location.");
    this.name = "UploadNeverCompletedError";
  }
}

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002" &&
    JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target)
  );
}

/**
 * Confirms `ownerId` genuinely belongs to the caller's tenant before letting
 * a MediaAsset attach to it — same "verify before FK" defense-in-depth
 * pattern already used at every route that accepts a foreign tenant-owned id
 * (e.g. compliance-documents route confirming driverId/vehicleId ownership).
 * Kept here (not the route) per D-007, so it's directly unit-testable and
 * applies to every caller, including future ones.
 */
async function assertOwnerExistsInTenant(tenantId: string, ownerType: MediaAssetOwnerType, ownerId: string): Promise<void> {
  let found: unknown = null;
  switch (ownerType) {
    case "GATE_EVENT":
    case "GATE_EVENT_INSPECTION_ITEM":
      found = await prisma.gateEvent.findFirst({ where: tenantWhere(tenantId, { id: ownerId }) });
      break;
    case "MANUAL_FACIAL_VERIFICATION_FALLBACK":
      found = await prisma.manualFacialVerificationFallback.findFirst({ where: tenantWhere(tenantId, { id: ownerId }) });
      break;
    case "DRIVER_PORTRAIT":
      found = await prisma.driver.findFirst({ where: tenantWhere(tenantId, { id: ownerId }) });
      break;
    case "COMPLIANCE_DOCUMENT":
      found = await prisma.complianceDocument.findFirst({ where: tenantWhere(tenantId, { id: ownerId }) });
      break;
    case "MOVEMENT_DOCUMENT":
      found = await prisma.movementAuthorisation.findFirst({ where: tenantWhere(tenantId, { id: ownerId }) });
      break;
  }
  if (!found) throw new MediaOwnerNotFoundError(ownerType, ownerId);
}

/**
 * Runs the category-appropriate compression pipeline (Phase 8B) against
 * already-validated bytes, and returns the *final* bytes/content-type that
 * should actually be persisted and checksummed — compression always runs
 * before the checksum is computed (ARCHITECTURE.md "Do not silently alter
 * previously uploaded evidence... generate the checksum after the final
 * evidence file is created"), never after.
 */
async function runCompressionPipeline(
  kind: "image" | "video" | "document",
  category: MediaCategory,
  data: Buffer,
  contentType: string,
): Promise<{ data: Buffer; contentType: string; compressionProfile: string | null; thumbnail: Buffer | null; original: Buffer | null }> {
  const rule = MEDIA_CATEGORY_RULES[category];

  if (kind === "image") {
    let compressed;
    try {
      compressed = await compressImage(data, rule.imageCompressionProfile);
    } catch (err) {
      throw new MediaProcessingError(err instanceof Error ? err.message : "image compression failed");
    }
    const thumbnail = await generateThumbnail(compressed.data).catch(() => null);
    const original = rule.preserveOriginalByDefault ? data : null;
    return { data: compressed.data, contentType: compressed.contentType, compressionProfile: compressed.profile, thumbnail, original };
  }

  if (kind === "video") {
    const result = await videoCompressionProvider.compress(data, contentType, rule.imageCompressionProfile);
    return { data: result.data, contentType: result.contentType, compressionProfile: result.transcoded ? result.profile : null, thumbnail: null, original: null };
  }

  return { data, contentType, compressionProfile: null, thumbnail: null, original: null };
}

export interface UploadMediaAssetInput {
  tenantId: string;
  actorUserId: string;
  ownerType: MediaAssetOwnerType;
  ownerId: string;
  fileName: string;
  contentType: string;
  data: Buffer;
  idempotencyKey: string;
  clientChecksumSha256?: string | null;
  /** Phase 8B — defaults to OTHER_DOCUMENT for callers that haven't been updated to pass one yet. */
  category?: MediaCategory;
  captureMetadata?: Record<string, unknown> | null;
}

/**
 * Uploads and records one piece of evidence (EVID-001/003), through the
 * app server (multipart/form-data) — see `initiatePresignedUpload()` /
 * `confirmPresignedUpload()` for the direct-to-storage path large files
 * should prefer instead (ARCHITECTURE.md "Technical constraints"). Order
 * matters: owner existence → type/size validation (against the original,
 * pre-compression bytes) → compression → checksum (always computed over the
 * *final*, post-compression bytes) → idempotency-key lookup (a genuine
 * retry returns the existing row unchanged, no second store() call, no
 * second DB row) → store → create.
 */
export async function uploadMediaAsset(input: UploadMediaAssetInput, provider: ObjectStorageProvider = defaultProvider) {
  await assertOwnerExistsInTenant(input.tenantId, input.ownerType, input.ownerId);

  if (input.data.byteLength === 0) throw new EmptyFileError();

  const kind = classifyContentType(input.contentType);
  if (!kind) throw new InvalidFileTypeError(input.contentType);

  const maxBytes = maxBytesForKind(kind);
  if (input.data.byteLength > maxBytes) throw new FileTooLargeError(kind, input.data.byteLength, maxBytes);

  const category = input.category ?? "OTHER_DOCUMENT";
  const processed = await runCompressionPipeline(kind, category, input.data, input.contentType);

  const checksumSha256 = crypto.createHash("sha256").update(processed.data).digest("hex");
  if (input.clientChecksumSha256 && input.clientChecksumSha256.toLowerCase() !== checksumSha256) {
    throw new ChecksumMismatchError();
  }

  const existing = await prisma.mediaAsset.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) {
    if (existing.checksumSha256 !== checksumSha256) throw new IdempotencyKeyConflictError();
    return existing;
  }

  const stored = await provider.store(input.tenantId, category, input.fileName, processed.data, processed.contentType);
  const thumbnailStored = processed.thumbnail
    ? await provider.store(input.tenantId, category, `${input.fileName}.thumb.webp`, processed.thumbnail, "image/webp")
    : null;
  const originalStored = processed.original
    ? await provider.store(input.tenantId, category, `${input.fileName}.original`, processed.original, input.contentType)
    : null;

  try {
    const created = await prisma.mediaAsset.create({
      data: {
        tenantId: input.tenantId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        capturedByUserId: input.actorUserId,
        fileName: input.fileName,
        contentType: processed.contentType,
        fileSizeBytes: processed.data.byteLength,
        storageKey: stored.storageKey,
        checksumSha256: stored.checksumSha256,
        idempotencyKey: input.idempotencyKey,
        category,
        uploadStatus: "READY",
        storageProvider: defaultProviderName,
        thumbnailStorageKey: thumbnailStored?.storageKey ?? null,
        originalStorageKey: originalStored?.storageKey ?? null,
        compressionProfile: processed.compressionProfile,
        captureMetadata: (input.captureMetadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorUserId,
      action: "mediaAsset.uploaded",
      entityType: "MediaAsset",
      entityId: created.id,
      afterValue: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        category,
        contentType: processed.contentType,
        fileSizeBytes: processed.data.byteLength,
        checksumSha256,
        compressionProfile: processed.compressionProfile,
      },
    });

    return created;
  } catch (err) {
    // Two concurrent requests racing the same idempotency key (e.g. a
    // double-tap over a flaky gate connection) — the loser's create()
    // P2002s; return the winner's row instead of erroring, same
    // server-side-enforcement spirit as DuplicateVehicleIdentifierError in
    // vehicle-repository.ts.
    if (isUniqueConstraintViolation(err, "idempotencyKey")) {
      const race = await prisma.mediaAsset.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (race) {
        if (race.checksumSha256 !== checksumSha256) throw new IdempotencyKeyConflictError();
        return race;
      }
    }
    throw err;
  }
}

// --- Phase 8B: presigned direct-to-storage upload ---------------------------

export interface InitiatePresignedUploadInput {
  tenantId: string;
  actorUserId: string;
  ownerType: MediaAssetOwnerType;
  ownerId: string;
  fileName: string;
  contentType: string;
  idempotencyKey: string;
  category?: MediaCategory;
  captureMetadata?: Record<string, unknown> | null;
}

export interface InitiatePresignedUploadResult {
  mediaAsset: Awaited<ReturnType<typeof prisma.mediaAsset.create>>;
  uploadUrl: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Reserves a storage key and mints a presigned upload URL (Phase 8B) —
 * nothing is validated about file size/type here because the bytes haven't
 * arrived yet; that happens in `confirmPresignedUpload()`, after the object
 * actually exists. The MediaAsset row is created immediately in `PENDING`
 * status so a client that never completes the upload leaves a discoverable,
 * cleanable trace (`cleanupFailedUploads()`) rather than a silent orphaned
 * storage key with no record at all.
 */
export async function initiatePresignedUpload(
  input: InitiatePresignedUploadInput,
  provider: ObjectStorageProvider = defaultProvider,
): Promise<InitiatePresignedUploadResult> {
  await assertOwnerExistsInTenant(input.tenantId, input.ownerType, input.ownerId);

  const existing = await prisma.mediaAsset.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) {
    const url = await provider.getSignedReadUrl(existing.storageKey, SIGNED_URL_DEFAULT_EXPIRY_SECONDS).catch(() => null);
    return {
      mediaAsset: existing,
      uploadUrl: url ?? "",
      method: "PUT",
      headers: {},
      expiresAt: new Date(),
    };
  }

  const category = input.category ?? "OTHER_DOCUMENT";
  const presigned = await provider.createPresignedUpload(input.tenantId, category, input.fileName, input.contentType, PRESIGNED_UPLOAD_EXPIRY_SECONDS);

  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      tenantId: input.tenantId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      capturedByUserId: input.actorUserId,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSizeBytes: 0,
      storageKey: presigned.storageKey,
      // Not yet known — filled in by confirmPresignedUpload() once the
      // object actually exists and its final bytes can be checksummed.
      checksumSha256: "",
      idempotencyKey: input.idempotencyKey,
      category,
      uploadStatus: "PENDING",
      storageProvider: defaultProviderName,
      captureMetadata: (input.captureMetadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "mediaAsset.uploadInitiated",
    entityType: "MediaAsset",
    entityId: mediaAsset.id,
    afterValue: { ownerType: input.ownerType, ownerId: input.ownerId, category },
  });

  return { mediaAsset, uploadUrl: presigned.uploadUrl, method: presigned.method, headers: presigned.headers, expiresAt: new Date(presigned.expiresAt * 1000) };
}

/**
 * Confirms a presigned upload actually completed (Phase 8B): verifies the
 * object exists (never trusts the client's own claim), reads it back to run
 * the same compression pipeline `uploadMediaAsset()` uses, re-stores the
 * *final* (post-compression) bytes under a fresh key, and updates the
 * MediaAsset row from PENDING to READY — or FAILED if the object never
 * arrived or processing fails, both audit-logged and typed so the calling
 * route never falls through to a generic 500.
 */
export async function confirmPresignedUpload(
  tenantId: string,
  actorUserId: string,
  mediaAssetId: string,
  provider: ObjectStorageProvider = defaultProvider,
) {
  const asset = await prisma.mediaAsset.findFirst({ where: tenantWhere(tenantId, { id: mediaAssetId }) });
  if (!asset || asset.uploadStatus !== "PENDING") throw new PendingUploadNotFoundError();

  const confirmation = await provider.confirmUpload(asset.storageKey);
  if (!confirmation.exists) {
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { uploadStatus: "FAILED" } });
    await recordAudit({ tenantId, userId: actorUserId, action: "mediaAsset.uploadFailed", entityType: "MediaAsset", entityId: asset.id, reason: "object never arrived at the reserved storage key" });
    throw new UploadNeverCompletedError();
  }

  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { uploadStatus: "PROCESSING" } });

  try {
    const uploaded = await provider.read(asset.storageKey);
    if (!uploaded) throw new UploadNeverCompletedError();

    if (uploaded.data.byteLength === 0) throw new EmptyFileError();
    const kind = classifyContentType(uploaded.contentType) ?? classifyContentType(asset.contentType);
    if (!kind) throw new InvalidFileTypeError(uploaded.contentType || asset.contentType);
    const maxBytes = maxBytesForKind(kind);
    if (uploaded.data.byteLength > maxBytes) throw new FileTooLargeError(kind, uploaded.data.byteLength, maxBytes);

    const processed = await runCompressionPipeline(kind, asset.category, uploaded.data, uploaded.contentType);
    const checksumSha256 = crypto.createHash("sha256").update(processed.data).digest("hex");

    // The uploaded object is the "original"; if the final bytes differ
    // (compression actually changed something), store the compressed
    // version under a new key and either keep or discard the original per
    // category policy — never mutate the object already at asset.storageKey
    // in place (ARCHITECTURE.md "do not silently alter previously uploaded
    // evidence").
    const bytesChanged = processed.data.length !== uploaded.data.length || processed.contentType !== uploaded.contentType;
    let finalStorageKey = asset.storageKey;
    let originalStorageKey: string | null = null;
    if (bytesChanged) {
      const final = await provider.store(tenantId, asset.category, asset.fileName, processed.data, processed.contentType);
      finalStorageKey = final.storageKey;
      const rule = MEDIA_CATEGORY_RULES[asset.category];
      if (rule.preserveOriginalByDefault) {
        originalStorageKey = asset.storageKey;
      } else {
        await provider.delete(asset.storageKey).catch(() => {});
      }
    }

    const thumbnailStored = processed.thumbnail
      ? await provider.store(tenantId, asset.category, `${asset.fileName}.thumb.webp`, processed.thumbnail, "image/webp")
      : null;

    const updated = await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        storageKey: finalStorageKey,
        checksumSha256,
        fileSizeBytes: processed.data.byteLength,
        contentType: processed.contentType,
        compressionProfile: processed.compressionProfile,
        thumbnailStorageKey: thumbnailStored?.storageKey ?? null,
        originalStorageKey,
        uploadStatus: "READY",
      },
    });

    await recordAudit({
      tenantId,
      userId: actorUserId,
      action: "mediaAsset.uploadConfirmed",
      entityType: "MediaAsset",
      entityId: asset.id,
      afterValue: { fileSizeBytes: processed.data.byteLength, checksumSha256, compressionProfile: processed.compressionProfile },
    });

    return updated;
  } catch (err) {
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { uploadStatus: "FAILED" } });
    await recordAudit({ tenantId, userId: actorUserId, action: "mediaAsset.uploadFailed", entityType: "MediaAsset", entityId: asset.id, reason: err instanceof Error ? err.message : "unknown error" });
    throw err;
  }
}

/**
 * Deletes any PENDING/FAILED MediaAsset row older than `olderThanMs` — a
 * presigned upload that was never confirmed, or one that failed processing
 * (Phase 8B "failed-upload cleanup"). Best-effort deletes the underlying
 * storage object too (ignoring "not found" — a PENDING row's object may
 * never have existed at all). A never-completed upload has no evidentiary
 * value to keep as a tombstone, so the row itself is removed, not just
 * marked — audit-logged before deletion so the cleanup itself is
 * traceable.
 */
export async function cleanupFailedUploads(
  tenantId?: string,
  olderThanMs: number = FAILED_UPLOAD_CLEANUP_AGE_MS,
  provider: ObjectStorageProvider = defaultProvider,
): Promise<{ cleanedCount: number }> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await prisma.mediaAsset.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      uploadStatus: { in: ["PENDING", "FAILED"] },
      createdAt: { lt: cutoff },
    },
  });

  for (const asset of stale) {
    await provider.delete(asset.storageKey).catch(() => {});
    await recordAudit({
      tenantId: asset.tenantId,
      userId: asset.capturedByUserId,
      action: "mediaAsset.failedUploadCleaned",
      entityType: "MediaAsset",
      entityId: asset.id,
      beforeValue: { uploadStatus: asset.uploadStatus, createdAt: asset.createdAt },
    });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
  }

  return { cleanedCount: stale.length };
}

// --- Phase 8B: storage usage accounting -------------------------------------

export interface StorageUsageByCategory {
  category: MediaCategory;
  totalBytes: number;
  assetCount: number;
}

export interface StorageUsageSummary {
  totalBytes: number;
  byCategory: StorageUsageByCategory[];
  failedUploadCount: number;
  pendingUploadCount: number;
}

/**
 * Real DB aggregate queries only (same "no static/mock values" discipline as
 * security-dashboard-repository.ts/support-access-repository.ts). Only
 * `READY` assets count toward billable storage — a PENDING upload's actual
 * bytes-on-disk aren't reliably known without an extra provider call per
 * asset, and a FAILED one is cleanup-eligible, not billable.
 */
export async function getStorageUsageForTenant(tenantId: string): Promise<StorageUsageSummary> {
  const [byCategory, failedUploadCount, pendingUploadCount] = await Promise.all([
    prisma.mediaAsset.groupBy({
      by: ["category"],
      where: { tenantId, uploadStatus: "READY" },
      _sum: { fileSizeBytes: true },
      _count: { _all: true },
    }),
    prisma.mediaAsset.count({ where: { tenantId, uploadStatus: "FAILED" } }),
    prisma.mediaAsset.count({ where: { tenantId, uploadStatus: "PENDING" } }),
  ]);

  const categories: StorageUsageByCategory[] = byCategory.map((row) => ({
    category: row.category,
    totalBytes: row._sum.fileSizeBytes ?? 0,
    assetCount: row._count._all,
  }));

  return {
    totalBytes: categories.reduce((sum, c) => sum + c.totalBytes, 0),
    byCategory: categories,
    failedUploadCount,
    pendingUploadCount,
  };
}

export async function getMediaAssetInTenant(tenantId: string, mediaAssetId: string) {
  return prisma.mediaAsset.findFirst({ where: tenantWhere(tenantId, { id: mediaAssetId }) });
}

/**
 * Lists every MediaAsset recorded against one polymorphic (ownerType,
 * ownerId) pair — e.g. every delivery-note document uploaded against a
 * movement (DISPATCH-003). Never returns a usable URL itself; callers still
 * go through `mintSignedUrlForMediaAsset()` per asset (EVID-002).
 */
export async function listMediaAssetsForOwner(tenantId: string, ownerType: MediaAssetOwnerType, ownerId: string) {
  return prisma.mediaAsset.findMany({
    where: tenantWhere(tenantId, { ownerType, ownerId }),
    orderBy: { capturedAt: "desc" },
  });
}

export interface MintSignedUrlResult {
  url: string;
  expiresAt: Date;
}

/**
 * Mints a short-lived signed read URL for a MediaAsset (EVID-002). The
 * caller (the route) must already have checked mediaAsset:VIEW; this
 * function re-verifies tenant ownership itself via tenantWhere() — defense
 * in depth, same principle as every other repository function in this
 * codebase, not just a route-level check. Records one audit entry at mint
 * time — see DECISIONS.md for why "mint time", not "every raw byte fetch",
 * is the chosen granularity for SECURITY_AND_POPIA.md's audit-on-read
 * requirement.
 */
export async function mintSignedUrlForMediaAsset(
  tenantId: string,
  actorUserId: string,
  mediaAssetId: string,
  expiresInSeconds: number = SIGNED_URL_DEFAULT_EXPIRY_SECONDS,
  provider: ObjectStorageProvider = defaultProvider,
): Promise<MintSignedUrlResult | null> {
  const asset = await prisma.mediaAsset.findFirst({ where: tenantWhere(tenantId, { id: mediaAssetId }) });
  if (!asset) return null;

  const url = await provider.getSignedReadUrl(asset.storageKey, expiresInSeconds);

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "mediaAsset.readAccessGranted",
    entityType: "MediaAsset",
    entityId: asset.id,
    reason: `Signed URL minted, expires in ${expiresInSeconds}s`,
  });

  return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
}

export interface ServeRawMediaInput {
  storageKey: string;
  expiresAt: number;
  signature: string;
  requestingTenantId: string;
}

/**
 * Verifies a signed raw-media request end to end (EVID-002 / TESTING.md
 * "media cannot be accessed using a public permanent URL"): signature +
 * expiry first (cheap, DB-free), then confirms the resource actually belongs
 * to the requesting session's tenant (defense in depth beyond the signature
 * alone — a signature can only ever have been minted for the tenant that
 * held mediaAsset:VIEW at mint time, but this closes the loop even if that
 * ever changed). Only on success does it read the bytes from disk.
 */
export async function serveRawMediaAsset(input: ServeRawMediaInput, provider: ObjectStorageProvider = defaultProvider) {
  const verification = verifyResourceAccess(input.storageKey, input.expiresAt, input.signature, "read");
  if (!verification.valid) throw new InvalidOrExpiredSignedUrlError(verification.reason);

  const asset = await prisma.mediaAsset.findUnique({ where: { storageKey: input.storageKey } });
  if (!asset) throw new MediaAssetNotFoundForStorageKeyError();
  if (asset.tenantId !== input.requestingTenantId) {
    // Deliberately the same error/shape as an invalid signature — this
    // endpoint must not reveal "the key was valid but you're the wrong
    // tenant" as a distinguishable response.
    throw new InvalidOrExpiredSignedUrlError("invalid_signature");
  }

  const file = await provider.read(input.storageKey);
  if (!file) throw new MediaAssetNotFoundForStorageKeyError();

  return { file, asset };
}
