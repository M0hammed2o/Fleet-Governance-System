import "server-only";
import crypto from "node:crypto";

/**
 * Encrypts/decrypts a driver's biometric face descriptor at rest (Phase
 * 9G — SECURITY_AND_POPIA.md). The key itself lives outside this database
 * entirely — an environment-provided secret, never a DB column, never
 * logged, never returned by any API response. `keyId` is stored alongside
 * the ciphertext (not the key itself) so a future key rotation can
 * identify which key encrypted a given row without needing to re-encrypt
 * every row in one atomic pass.
 */

export class EncryptionKeyNotConfiguredError extends Error {
  constructor() {
    super("BIOMETRIC_TEMPLATE_ENCRYPTION_KEY is not configured — biometric enrolment and matching are disabled until it is set.");
    this.name = "EncryptionKeyNotConfiguredError";
  }
}

export class UnknownEncryptionKeyError extends Error {
  constructor(keyId: string) {
    super(`No configured key matches encryption key id "${keyId}".`);
    this.name = "UnknownEncryptionKeyError";
  }
}

// Bump this (and keep the old key available for decrypting existing rows)
// when rotating BIOMETRIC_TEMPLATE_ENCRYPTION_KEY in production.
export const ACTIVE_KEY_ID = "env-v1";

function loadKey(): Buffer {
  const raw = process.env.BIOMETRIC_TEMPLATE_ENCRYPTION_KEY;
  if (!raw) throw new EncryptionKeyNotConfiguredError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BIOMETRIC_TEMPLATE_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256-GCM.");
  }
  return key;
}

export interface EncryptedTemplate {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
}

/** `descriptor` is a small float array (e.g. 128 dimensions) — never image bytes, never raw video. */
export function encryptTemplate(descriptor: readonly number[]): EncryptedTemplate {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(Float32Array.from(descriptor).buffer);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag, keyId: ACTIVE_KEY_ID };
}

/** Accepts plain Uint8Array (what Prisma returns for a `Bytes` column) as well as Buffer — Buffer is itself a Uint8Array subclass. */
export function decryptTemplate(encrypted: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array; keyId: string }): number[] {
  if (encrypted.keyId !== ACTIVE_KEY_ID) throw new UnknownEncryptionKeyError(encrypted.keyId);
  const key = loadKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv));
  decipher.setAuthTag(Buffer.from(encrypted.authTag));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext)), decipher.final()]);
  const floatArray = new Float32Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength / Float32Array.BYTES_PER_ELEMENT);
  return Array.from(floatArray);
}
