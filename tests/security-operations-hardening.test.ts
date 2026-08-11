import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { authenticationAttemptHashes, checkLoginRateLimit, normaliseClientIp, recordAuthenticationAttempt } from "@/lib/auth/login-rate-limit";
import { runJob } from "@/lib/jobs/run-job";

const createdAttemptHashes: Array<{ identifierHash: string; ipHash: string }> = [];

afterEach(async () => {
  await Promise.all(createdAttemptHashes.splice(0).map((hashes) => prisma.authenticationAttempt.deleteMany({ where: { OR: [{ identifierHash: hashes.identifierHash }, { ipHash: hashes.ipHash }] } })));
});

describe("authentication throttling", () => {
  it("stores only keyed digests and rate-limits repeated identity failures", async () => {
    const marker = crypto.randomUUID();
    const input = { tenantSlug: `tenant-${marker}`, email: `${marker}@example.test`, ip: "192.0.2.25" };
    const hashes = authenticationAttemptHashes(input);
    createdAttemptHashes.push(hashes);
    expect(hashes.identifierHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(hashes)).not.toContain(marker);

    for (let attempt = 0; attempt < 8; attempt += 1) await recordAuthenticationAttempt({ ...input, succeeded: false });
    expect(await checkLoginRateLimit(input)).toMatchObject({ limited: true });
    const stored = await prisma.authenticationAttempt.findMany({ where: { identifierHash: hashes.identifierHash } });
    expect(stored).toHaveLength(8);
    expect(JSON.stringify(stored)).not.toContain(input.email);

    await recordAuthenticationAttempt({ ...input, succeeded: true });
    expect((await checkLoginRateLimit(input)).limited).toBe(false);
  });

  it("uses only the first forwarded address and bounds its length", () => {
    expect(normaliseClientIp("198.51.100.2, 10.0.0.1")).toBe("198.51.100.2");
    expect(normaliseClientIp("x".repeat(500))).toHaveLength(128);
    expect(normaliseClientIp(null)).toBe("unknown");
  });
});

describe("job diagnostic redaction", () => {
  it("redacts credentials and personal email from persisted job errors", async () => {
    const jobName = `security.redaction.${crypto.randomUUID()}`;
    await expect(runJob(jobName, async () => { throw new Error("Bearer super-secret-token for person@example.test"); })).rejects.toThrow();
    const run = await prisma.jobRun.findFirstOrThrow({ where: { jobName } });
    expect(run.errorMessage).toContain("[REDACTED]");
    expect(run.errorMessage).not.toContain("super-secret-token");
    expect(run.errorMessage).not.toContain("person@example.test");
  });
});
