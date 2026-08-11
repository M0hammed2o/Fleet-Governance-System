import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertDistinctRestoreTarget, validateLocalDatabaseTarget } from "@/lib/db/database-safety";
import { LocalFilesystemStorageProvider } from "@/lib/storage/local-filesystem-provider";
import { R2CompatibleStorageProvider } from "@/lib/storage/r2-compatible-provider";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local backup safety guards", () => {
  it.each([
    undefined,
    "not-a-url",
    "mysql://user:password@localhost/example_test",
    "postgresql://user:password@db.example.com/example_test",
    "postgresql://user:password@localhost/production",
  ])("refuses an unsafe target without echoing credentials: %s", (databaseUrl) => {
    const result = validateLocalDatabaseTarget(databaseUrl);
    expect(result.safe).toBe(false);
    if (!result.safe) expect(result.reason).not.toContain("password");
  });

  it("accepts only an explicitly named loopback test database", () => {
    expect(validateLocalDatabaseTarget("postgresql://user:secret@127.0.0.1:55490/fleet_test")).toMatchObject({
      safe: true,
      target: { database: "fleet_test", username: "user" },
    });
  });

  it("requires a distinct disposable restore database", () => {
    const target = { host: "localhost", port: "5432", database: "fleet_test", username: "user" };
    expect(() => assertDistinctRestoreTarget(target, target)).toThrow(/different/);
    expect(() => assertDistinctRestoreTarget(target, { ...target, database: "another_test" })).toThrow(/restore_verify/);
    expect(() => assertDistinctRestoreTarget(target, { ...target, database: "fleet_restore_verify" })).not.toThrow();
  });
});

describe("object-storage adapter contract", () => {
  it("keeps objects private, tenant-prefixed, integrity-checked, signed, and deletable", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "storage-contract-"));
    temporaryDirectories.push(directory);
    const provider = new LocalFilesystemStorageProvider(directory);
    const stored = await provider.store("tenant-a", "OTHER_DOCUMENT", "evidence.txt", Buffer.from("evidence"), "text/plain");

    expect(provider.capabilities).toMatchObject({ privateObjects: true, tenantPrefixedKeys: true, signedReads: true, integrityMetadata: true, deleteObjects: true });
    expect(stored.storageKey).toMatch(/^tenant-a\/OTHER_DOCUMENT\//);
    expect(stored.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await provider.read(stored.storageKey)).toEqual({ data: Buffer.from("evidence"), contentType: "text/plain" });
    expect(await provider.getSignedReadUrl(stored.storageKey, 60)).toMatch(/^\/api\/media\/raw\?/);
    expect(await provider.healthCheck()).toEqual({ status: "healthy", detail: "local private storage is writable" });

    await provider.delete(stored.storageKey);
    expect(await provider.read(stored.storageKey)).toBeNull();
  });

  it("reports an unconfigured production boundary without making a provider call", async () => {
    const provider = new R2CompatibleStorageProvider(null);
    expect(await provider.healthCheck()).toEqual({ status: "not_configured", detail: "durable object storage is not configured" });
    await expect(provider.store("tenant-a", "OTHER_DOCUMENT", "x.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/not configured/i);
  });
});
