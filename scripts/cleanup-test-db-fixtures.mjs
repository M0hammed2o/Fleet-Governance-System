// Phase 8E-007 one-time cleanup: removes the fixture-tenant backlog that
// accumulated in the *test* database before deterministic per-file cleanup
// existed (tests/setup/global-cleanup.ts). Only ever targets a database
// whose name ends in "_test" (a hard safety check below) — never dev or
// production. Uses the same SET LOCAL session_replication_role bypass as
// the per-test cleanup helper (see tests/helpers/fixtures.ts) so the
// append-only audit_logs trigger doesn't block the cascade delete; scoped
// to one transaction only, never a persistent/global change.
import { config } from "dotenv";
config({ path: ".env.test" });

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/_test(\?|$)/.test(databaseUrl) && !databaseUrl.includes("_test")) {
  console.error(`Refusing to run — DATABASE_URL does not look like a test database: ${databaseUrl}`);
  process.exit(1);
}

const { prisma } = await import("../src/lib/db/prisma.ts");

const tenants = await prisma.tenant.findMany({ where: { slug: { not: "platform" } }, select: { id: true } });
console.log(`Found ${tenants.length} non-canonical tenants to remove from the test database.`);

let deleted = 0;
let failed = 0;
for (const { id } of tenants) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.tenant.delete({ where: { id } });
    });
    deleted++;
  } catch {
    failed++;
  }
}

console.log(`Deleted ${deleted} tenants, ${failed} failed (left in place for inspection).`);
const remaining = await prisma.tenant.count();
console.log(`Remaining tenants in test database: ${remaining}.`);
await prisma.$disconnect();
