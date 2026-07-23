import crypto from "node:crypto";

/**
 * Pure, DB-free signing/verification for the local-filesystem
 * StorageProvider's "signed, time-limited, server-verified URL scheme"
 * (ARCHITECTURE.md "Media/video architecture") — same "pure decision
 * function, directly unit-testable" pattern already used for
 * evaluateSession() and the movement/gate-event state machines. Nothing here
 * touches Prisma; `local-filesystem-provider.ts`'s `getSignedReadUrl()` is the
 * only caller, signing the object's `storageKey` (matching the
 * `StorageProvider.getSignedReadUrl(storageKey, expiresInSeconds)` interface
 * shape) after `media-asset-repository.ts` has already done a
 * tenant/permission check.
 *
 * HMAC-SHA256 over `${resourceKey}.${expiresAtEpochSeconds}`, keyed by
 * MEDIA_URL_SIGNING_SECRET. A forged/altered resourceKey or expiresAt
 * invalidates the signature; an expired-but-correctly-signed token is
 * rejected separately so the two failure reasons stay distinguishable (same
 * reasoning as evaluateSession()'s distinct reason codes).
 */

const DEV_FALLBACK_SECRET = "dev-only-insecure-media-signing-secret-change-me";

/** Dev-only fallback so local/test environments work without extra setup — never used if MEDIA_URL_SIGNING_SECRET is set (see .env.example). */
export function getMediaSigningSecret(): string {
  return process.env.MEDIA_URL_SIGNING_SECRET || DEV_FALLBACK_SECRET;
}

function computeSignature(resourceKey: string, expiresAt: number, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${resourceKey}.${expiresAt}`).digest("hex");
}

export interface SignedResourceAccessToken {
  expiresAt: number; // epoch seconds
  signature: string;
}

export function signResourceAccess(
  resourceKey: string,
  expiresInSeconds: number,
  secret: string = getMediaSigningSecret(),
  now: Date = new Date(),
): SignedResourceAccessToken {
  const expiresAt = Math.floor(now.getTime() / 1000) + expiresInSeconds;
  return { expiresAt, signature: computeSignature(resourceKey, expiresAt, secret) };
}

export type ResourceAccessVerification = { valid: true } | { valid: false; reason: "expired" | "invalid_signature" };

export function verifyResourceAccess(
  resourceKey: string,
  expiresAt: number,
  signature: string,
  secret: string = getMediaSigningSecret(),
  now: Date = new Date(),
): ResourceAccessVerification {
  const expected = computeSignature(resourceKey, expiresAt, secret);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  const signatureValid = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  if (!signatureValid) return { valid: false, reason: "invalid_signature" };
  if (expiresAt < Math.floor(now.getTime() / 1000)) return { valid: false, reason: "expired" };
  return { valid: true };
}
