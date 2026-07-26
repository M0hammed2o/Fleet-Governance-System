import { describe, it, expect } from "vitest";
import { signResourceAccess, verifyResourceAccess } from "@/lib/storage/signed-url";

describe("signed media URL signing/verification (pure, DB-free — lib/storage/signed-url.ts)", () => {
  const secret = "test-secret-value";

  it("verifies a freshly signed token as valid", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const token = signResourceAccess("tenant1/some-key.jpg", 300, "read", secret, now);
    const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, token.signature, "read", secret, now);
    expect(result.valid).toBe(true);
  });

  it("rejects a token whose expiresAt has passed ('expired', not 'invalid_signature')", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const token = signResourceAccess("tenant1/some-key.jpg", 60, "read", secret, now);
    const later = new Date(now.getTime() + 61_000);
    const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, token.signature, "read", secret, later);
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("accepts a token at the exact expiry boundary (not yet expired)", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const token = signResourceAccess("tenant1/some-key.jpg", 60, "read", secret, now);
    const atBoundary = new Date(now.getTime() + 60_000);
    const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, token.signature, "read", secret, atBoundary);
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered resourceKey (signature no longer matches)", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const token = signResourceAccess("tenant1/some-key.jpg", 300, "read", secret, now);
    const result = verifyResourceAccess("tenant2/some-key.jpg", token.expiresAt, token.signature, "read", secret, now);
    expect(result).toEqual({ valid: false, reason: "invalid_signature" });
  });

  it("rejects a tampered expiresAt (extending an about-to-expire token)", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const token = signResourceAccess("tenant1/some-key.jpg", 60, "read", secret, now);
    const forgedExpiry = token.expiresAt + 10_000;
    const result = verifyResourceAccess("tenant1/some-key.jpg", forgedExpiry, token.signature, "read", secret, now);
    expect(result).toEqual({ valid: false, reason: "invalid_signature" });
  });

  it("rejects a signature produced with a different secret", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const token = signResourceAccess("tenant1/some-key.jpg", 300, "read", secret, now);
    const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, token.signature, "read", "a-different-secret", now);
    expect(result).toEqual({ valid: false, reason: "invalid_signature" });
  });

  it("rejects a garbage/malformed signature string without throwing", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const token = signResourceAccess("tenant1/some-key.jpg", 300, "read", secret, now);
    expect(() => verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, "not-hex-!!!", "read", secret, now)).not.toThrow();
    const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, "not-hex-!!!", "read", secret, now);
    expect(result.valid).toBe(false);
  });

  describe("purpose isolation (Phase 8B)", () => {
    it("rejects a read-purpose token verified as an upload-purpose token", () => {
      const now = new Date("2026-01-01T12:00:00Z");
      const token = signResourceAccess("tenant1/some-key.jpg", 300, "read", secret, now);
      const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, token.signature, "upload", secret, now);
      expect(result).toEqual({ valid: false, reason: "invalid_signature" });
    });

    it("rejects an upload-purpose token verified as a read-purpose token", () => {
      const now = new Date("2026-01-01T12:00:00Z");
      const token = signResourceAccess("tenant1/some-key.jpg", 300, "upload", secret, now);
      const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, token.signature, "read", secret, now);
      expect(result).toEqual({ valid: false, reason: "invalid_signature" });
    });

    it("accepts an upload-purpose token verified as upload", () => {
      const now = new Date("2026-01-01T12:00:00Z");
      const token = signResourceAccess("tenant1/some-key.jpg", 300, "upload", secret, now);
      const result = verifyResourceAccess("tenant1/some-key.jpg", token.expiresAt, token.signature, "upload", secret, now);
      expect(result.valid).toBe(true);
    });
  });
});
