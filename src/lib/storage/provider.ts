import type { MediaCategory } from "@/generated/prisma/client";

/**
 * Object-storage adapter interface (Phase 4 EVID-001..004, extended Phase 8B
 * for provider-neutral presigned upload/download and cost-efficient media
 * architecture). Same "interface + a working dev implementation, production
 * provider stays swappable and unselected" pattern already used for
 * FacialVerificationProvider (Phase 2) and TelematicsProvider (Phase 6). No
 * call site outside `lib/storage/` and `lib/repositories/media-asset-repository.ts`
 * should ever depend on a specific implementation.
 *
 * Every implementation must guarantee:
 *   - Private buckets/directories only — there is no public/permanent URL to
 *     any stored object, ever.
 *   - `store()` never trusts a caller-supplied checksum; the caller
 *     (media-asset-repository.ts) computes and verifies SHA-256 itself,
 *     always against the *final* bytes actually persisted (after
 *     compression), never the bytes the client originally sent.
 *   - `getSignedReadUrl()`/`createPresignedUpload()` never return a
 *     public/permanent URL — both must expire and must be server-verifiable
 *     (see lib/storage/signed-url.ts for the local-filesystem
 *     implementation's signing scheme; a real S3/R2 provider uses the
 *     vendor's own presigned-URL mechanism instead).
 *   - `read()` is only ever called from the server-side signed-URL-serving
 *     route, never exposed directly to a client.
 *   - Storage keys are always tenant-prefixed (`${tenantId}/${category}/...`)
 *     — never a bare filename, so per-tenant/per-category storage usage can
 *     always be attributed correctly even if a provider's own accounting is
 *     unavailable.
 */
export interface StoredFile {
  storageKey: string;
  checksumSha256: string;
  fileSizeBytes: number;
}

export interface ReadFileResult {
  data: Buffer;
  contentType: string;
}

export interface PresignedUpload {
  /** The URL the client should PUT/POST the raw bytes to directly (never through this app's own request thread — ARCHITECTURE.md "Technical constraints"). */
  uploadUrl: string;
  method: "PUT" | "POST";
  /** Extra headers the client must send with the upload request (e.g. Content-Type — provider-specific, may be empty). */
  headers: Record<string, string>;
  storageKey: string;
  expiresAt: number; // epoch seconds
}

export interface ConfirmUploadResult {
  exists: boolean;
  fileSizeBytes: number | null;
}

export interface StorageProviderCapabilities {
  privateObjects: true;
  tenantPrefixedKeys: true;
  signedReads: true;
  presignedUploads: boolean;
  integrityMetadata: true;
  deleteObjects: true;
  archiveTier: boolean;
  legalHoldApi: boolean;
  credentialRotation: boolean;
}

export interface StorageHealthResult {
  status: "healthy" | "degraded" | "not_configured";
  /** Safe operator-facing classification only; never include endpoints, bucket names, paths, or credentials. */
  detail: string;
}

export interface ObjectStorageProvider {
  readonly providerId: string;
  readonly capabilities: StorageProviderCapabilities;

  /** Read-only dependency probe. Implementations must not create or expose customer objects. */
  healthCheck(): Promise<StorageHealthResult>;
  /**
   * Persists `data` under a new, tenant-and-category-namespaced storage key
   * and returns that key plus the server-computed SHA-256 checksum and size
   * of the bytes actually written.
   */
  store(tenantId: string, category: MediaCategory, fileName: string, data: Buffer, contentType: string): Promise<StoredFile>;

  /**
   * Mints a presigned direct-to-storage upload target (Phase 8B) — the
   * large-upload path ARCHITECTURE.md's "Technical constraints" already
   * calls for ("large media uploads must not block the main request
   * thread... direct-to-storage via presigned URLs where the provider
   * supports it, with server-side verification after upload completes").
   * The returned `storageKey` is reserved immediately; nothing is written
   * until the client actually uses the URL and `confirmUpload()` is called.
   */
  createPresignedUpload(
    tenantId: string,
    category: MediaCategory,
    fileName: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;

  /** Server-side verification after a presigned upload completes — confirms the object actually exists and reports its real size, never trusting the client's own claim. */
  confirmUpload(storageKey: string): Promise<ConfirmUploadResult>;

  /**
   * Mints a short-lived, server-verified URL for reading back a previously
   * stored object. Never a static/public path.
   */
  getSignedReadUrl(storageKey: string, expiresInSeconds: number): Promise<string>;

  /** Reads the raw bytes back — only ever called server-side, after all permission/signature checks have passed. */
  read(storageKey: string): Promise<ReadFileResult | null>;

  /** Permanently removes the stored object (used by failed-upload cleanup and, from Phase 8C, retention deletion). */
  delete(storageKey: string): Promise<void>;
}
