/**
 * Refuses to let prisma/seed.ts run anywhere but a local dev/test database.
 * The seed script creates fictional accounts that all share one known
 * password — acceptable only for local development.
 */
export function assertSafeToSeed(
  databaseUrl: string,
  env: { NODE_ENV?: string; ALLOW_SEED_NON_LOCALHOST?: string } = process.env,
): void {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run: NODE_ENV=production. This seed script must never touch a production database.");
  }

  const host = new URL(databaseUrl).hostname;
  const allowedHosts = new Set(["localhost", "127.0.0.1"]);
  if (!allowedHosts.has(host) && env.ALLOW_SEED_NON_LOCALHOST !== "true") {
    throw new Error(
      `Refusing to run: DATABASE_URL host "${host}" is not localhost/127.0.0.1. This script creates ` +
        `accounts with a known shared password and must only run against local dev/test databases. If ` +
        `this genuinely is a safe non-production environment, set ALLOW_SEED_NON_LOCALHOST=true to override.`,
    );
  }
}
