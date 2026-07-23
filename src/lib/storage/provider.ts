/**
 * Object-storage adapter interface — Phase 4 (EVID-001..004). Same "interface
 * + a working dev implementation, production provider stays swappable and
 * unselected" pattern already used for FacialVerificationProvider (Phase 2)
 * and TelematicsProvider's planned shape (INTEGRATIONS.md). No call site
 * outside `lib/storage/` and `lib/repositories/media-asset-repository.ts`
 * should ever depend on a specific implementation.
 *
 * Every implementation must guarantee:
 *   - `store()` never trusts a caller-supplied checksum; the caller
 *     (media-asset-repository.ts) computes and verifies SHA-256 itself.
 *   - `getSignedReadUrl()` never returns a public/permanent URL — the result
 *     must expire and must be server-verifiable (see lib/storage/signed-url.ts
 *     for the local-filesystem implementation's signing scheme).
 *   - `read()` is only ever called from the server-side signed-URL-serving
 *     route, never exposed directly to a client.
 */
export interface StoredFile {
  storageKey: string;
  checksumSha256: string;
}

export interface ReadFileResult {
  data: Buffer;
  contentType: string;
}

export interface StorageProvider {
  /**
   * Persists `data` under a new, tenant-namespaced storage key and returns
   * that key plus the server-computed SHA-256 checksum of the bytes actually
   * written (the caller should compare this against its own independently
   * computed checksum — belt and braces, see ChecksumMismatchError).
   */
  store(tenantId: string, fileName: string, data: Buffer, contentType: string): Promise<StoredFile>;

  /**
   * Mints a short-lived, server-verified URL for reading back a previously
   * stored object. Never a static/public path — see the local-filesystem
   * implementation's HMAC-signed scheme in lib/storage/signed-url.ts, and the
   * `/api/media/[id]/raw` route that verifies it.
   */
  getSignedReadUrl(storageKey: string, expiresInSeconds: number): Promise<string>;

  /** Reads the raw bytes back — only ever called server-side, after all permission/signature checks have passed. */
  read(storageKey: string): Promise<ReadFileResult | null>;

  /** Permanently removes the stored object. Not yet wired to any route (no delete flow in this phase) — provided for completeness / future retention-purge job (see TODO.md). */
  delete(storageKey: string): Promise<void>;
}
