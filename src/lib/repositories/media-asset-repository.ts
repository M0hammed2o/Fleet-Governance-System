import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { LocalFilesystemStorageProvider } from "@/lib/storage/local-filesystem-provider";
import { verifyResourceAccess } from "@/lib/storage/signed-url";
import type { StorageProvider } from "@/lib/storage/provider";
import type { MediaAssetOwnerType } from "@/generated/prisma/client";

const defaultProvider: StorageProvider = new LocalFilesystemStorageProvider();

// File-type/size limits (EVID-001). No pre-existing convention was found
// anywhere in the docs for this, so these are a deliberate, documented
// choice — see DECISIONS.md.
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB

// Short-lived on purpose (SECURITY_AND_POPIA.md "short-lived signed URLs") —
// long enough for a browser to actually load an <img>/<video> src in one
// round trip, short enough that a leaked URL (e.g. copy-pasted, cached
// proxy log) stops working quickly. See DECISIONS.md for the exact value
// chosen and why.
export const SIGNED_URL_DEFAULT_EXPIRY_SECONDS = 300;

const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const ALLOWED_VIDEO_CONTENT_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export function classifyContentType(contentType: string): "image" | "video" | null {
  const normalized = contentType.toLowerCase();
  if (ALLOWED_IMAGE_CONTENT_TYPES.has(normalized)) return "image";
  if (ALLOWED_VIDEO_CONTENT_TYPES.has(normalized)) return "video";
  return null;
}

// --- Typed errors ------------------------------------------------------------
// Every precondition/business-rule violation below is a typed class, not a
// plain Error — this codebase has hit the "untyped Error surfaces as a
// generic 500 instead of a 4xx" bug three times already (BUG-001/002/003,
// see KNOWN_BUGS.md). Every route that calls into this file explicitly
// catches each of these and maps it to the correct status code.

export class InvalidFileTypeError extends Error {
  constructor(contentType: string) {
    super(
      `Unsupported file type "${contentType}". Only images (${[...ALLOWED_IMAGE_CONTENT_TYPES].join(", ")}) ` +
        `and video (${[...ALLOWED_VIDEO_CONTENT_TYPES].join(", ")}) are accepted.`,
    );
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
  constructor(kind: "image" | "video", actualBytes: number, maxBytes: number) {
    super(
      `${kind === "image" ? "Image" : "Video"} exceeds the maximum allowed size ` +
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
}

/**
 * Uploads and records one piece of evidence (EVID-001/003). Order matters:
 * owner existence → type/size validation → checksum → idempotency-key
 * lookup (a genuine retry returns the existing row untouched, no second
 * store() call, no second DB row) → store → create. The checksum is always
 * computed server-side from the actual bytes received; a client-supplied
 * checksum, if present, is only ever used as an optional extra integrity
 * cross-check, never trusted on its own (ARCHITECTURE.md).
 */
export async function uploadMediaAsset(input: UploadMediaAssetInput, provider: StorageProvider = defaultProvider) {
  await assertOwnerExistsInTenant(input.tenantId, input.ownerType, input.ownerId);

  if (input.data.byteLength === 0) throw new EmptyFileError();

  const kind = classifyContentType(input.contentType);
  if (!kind) throw new InvalidFileTypeError(input.contentType);

  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (input.data.byteLength > maxBytes) throw new FileTooLargeError(kind, input.data.byteLength, maxBytes);

  const checksumSha256 = crypto.createHash("sha256").update(input.data).digest("hex");
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

  const stored = await provider.store(input.tenantId, input.fileName, input.data, input.contentType);

  try {
    const created = await prisma.mediaAsset.create({
      data: {
        tenantId: input.tenantId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        capturedByUserId: input.actorUserId,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.data.byteLength,
        storageKey: stored.storageKey,
        checksumSha256: stored.checksumSha256,
        idempotencyKey: input.idempotencyKey,
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
        contentType: input.contentType,
        fileSizeBytes: input.data.byteLength,
        checksumSha256,
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
  provider: StorageProvider = defaultProvider,
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
export async function serveRawMediaAsset(input: ServeRawMediaInput, provider: StorageProvider = defaultProvider) {
  const verification = verifyResourceAccess(input.storageKey, input.expiresAt, input.signature);
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
