import { describe, it, expect } from "vitest";
import { encryptTemplate, decryptTemplate, ACTIVE_KEY_ID, UnknownEncryptionKeyError } from "@/lib/facial-verification/template-encryption";

function fakeDescriptor(seed: number, length = 128): number[] {
  return Array.from({ length }, (_, i) => Math.sin(seed + i) * 10);
}

describe("Phase 9C/9G: template-encryption", () => {
  it("round-trips a descriptor through encrypt/decrypt exactly (within float32 precision)", () => {
    const descriptor = fakeDescriptor(1);
    const encrypted = encryptTemplate(descriptor);
    const decrypted = decryptTemplate(encrypted);

    expect(decrypted).toHaveLength(descriptor.length);
    decrypted.forEach((value, i) => {
      expect(value).toBeCloseTo(descriptor[i], 5);
    });
  });

  it("never stores the descriptor in plaintext — ciphertext bytes do not equal the raw float bytes", () => {
    const descriptor = fakeDescriptor(2);
    const encrypted = encryptTemplate(descriptor);
    const plaintextBuffer = Buffer.from(Float32Array.from(descriptor).buffer);
    expect(Buffer.compare(encrypted.ciphertext, plaintextBuffer)).not.toBe(0);
  });

  it("tags the encrypted output with the active key id", () => {
    const encrypted = encryptTemplate(fakeDescriptor(3));
    expect(encrypted.keyId).toBe(ACTIVE_KEY_ID);
  });

  it("produces a different iv (and ciphertext) on every call — never reuses an iv", () => {
    const descriptor = fakeDescriptor(4);
    const first = encryptTemplate(descriptor);
    const second = encryptTemplate(descriptor);
    expect(Buffer.compare(first.iv, second.iv)).not.toBe(0);
    expect(Buffer.compare(first.ciphertext, second.ciphertext)).not.toBe(0);
  });

  it("rejects decryption against an unrecognised key id", () => {
    const encrypted = encryptTemplate(fakeDescriptor(5));
    expect(() => decryptTemplate({ ...encrypted, keyId: "some-other-key" })).toThrow(UnknownEncryptionKeyError);
  });

  it("fails to decrypt (auth-tag mismatch) if the ciphertext is tampered with", () => {
    const encrypted = encryptTemplate(fakeDescriptor(6));
    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[0] = tampered[0] ^ 0xff;
    expect(() => decryptTemplate({ ...encrypted, ciphertext: tampered })).toThrow();
  });
});
