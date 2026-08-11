import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const IDENTIFIER_FAILURE_LIMIT = 8;
const IP_FAILURE_LIMIT = 30;
const RETENTION_MS = 24 * 60 * 60 * 1000;

function throttleSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.APP_ENV === "production") throw new Error("SESSION_SECRET is required for authentication throttling.");
  return secret || "development-only-auth-throttle-key";
}

function digest(value: string): string {
  return crypto.createHmac("sha256", throttleSecret()).update(value).digest("hex");
}

export function normaliseClientIp(raw: string | null): string {
  return (raw?.split(",")[0]?.trim() || "unknown").slice(0, 128);
}

export function authenticationAttemptHashes(input: { tenantSlug: string; email: string; ip: string }) {
  return {
    identifierHash: digest(`${input.tenantSlug.trim().toLowerCase()}|${input.email.trim().toLowerCase()}`),
    ipHash: digest(input.ip),
  };
}

export async function checkLoginRateLimit(input: { tenantSlug: string; email: string; ip: string }, now = new Date()) {
  const hashes = authenticationAttemptHashes(input);
  const since = new Date(now.getTime() - WINDOW_MS);
  const [identifierFailures, ipFailures] = await Promise.all([
    prisma.authenticationAttempt.count({ where: { identifierHash: hashes.identifierHash, succeeded: false, attemptedAt: { gte: since } } }),
    prisma.authenticationAttempt.count({ where: { ipHash: hashes.ipHash, succeeded: false, attemptedAt: { gte: since } } }),
  ]);
  return { limited: identifierFailures >= IDENTIFIER_FAILURE_LIMIT || ipFailures >= IP_FAILURE_LIMIT, ...hashes };
}

export async function recordAuthenticationAttempt(input: { tenantSlug: string; email: string; ip: string; succeeded: boolean }, now = new Date()): Promise<void> {
  const hashes = authenticationAttemptHashes(input);
  await prisma.$transaction(async (tx) => {
    await tx.authenticationAttempt.create({ data: { ...hashes, succeeded: input.succeeded, attemptedAt: now } });
    if (input.succeeded) await tx.authenticationAttempt.deleteMany({ where: { identifierHash: hashes.identifierHash, succeeded: false } });
    await tx.authenticationAttempt.deleteMany({
      where: {
        attemptedAt: { lt: new Date(now.getTime() - RETENTION_MS) },
        OR: [{ identifierHash: hashes.identifierHash }, { ipHash: hashes.ipHash }],
      },
    });
  });
}
