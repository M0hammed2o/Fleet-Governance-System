import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: InstanceType<typeof PrismaClient> };

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  // A single page load (e.g. onboarding, driver detail) can legitimately
  // fan out into a dozen-plus concurrent queries across its API routes and
  // their own internal Promise.all calls; 10 was tight enough to produce
  // intermittent connection-acquisition failures under ordinary browser
  // navigation (verified live), not just heavy concurrent traffic.
  const max = Number(process.env.DATABASE_MAX_CONNECTIONS ?? 25);
  const connectionTimeoutMillis = Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 10_000);
  const statementTimeout = Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? 15_000);
  const idleInTransactionSessionTimeout = Number(process.env.DATABASE_TRANSACTION_TIMEOUT_MS ?? 30_000);
  const adapter = new PrismaPg({
    connectionString,
    max: Number.isInteger(max) && max > 0 ? Math.min(max, 50) : 10,
    connectionTimeoutMillis:
      Number.isInteger(connectionTimeoutMillis) && connectionTimeoutMillis >= 500
        ? Math.min(connectionTimeoutMillis, 30_000)
        : 5_000,
    statement_timeout:
      Number.isInteger(statementTimeout) && statementTimeout >= 1_000
        ? Math.min(statementTimeout, 120_000)
        : 15_000,
    idle_in_transaction_session_timeout:
      Number.isInteger(idleInTransactionSessionTimeout) && idleInTransactionSessionTimeout >= 1_000
        ? Math.min(idleInTransactionSessionTimeout, 300_000)
        : 30_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
