import { config } from "dotenv";
import { PILOT_TENANT_ID, PILOT_TENANT_SLUG } from "../src/lib/pilot/pilot-safety";
import { resetPilotTenant, seedPilotTenant, verifyPilotTenant, withPilotClient } from "../src/lib/pilot/pilot-dataset";

config({ path: ".env", quiet: true });

async function main() {
  await withPilotClient(async (prisma) => {
    const before = await prisma.tenant.findMany({ where: { id: { not: PILOT_TENANT_ID } }, select: { id: true }, orderBy: { id: "asc" } });
    await seedPilotTenant(prisma);
    const first = await verifyPilotTenant(prisma);
    await seedPilotTenant(prisma);
    const second = await verifyPilotTenant(prisma);
    if (JSON.stringify(first.counts) !== JSON.stringify(second.counts)) throw new Error("Pilot seed is not idempotent.");

    await resetPilotTenant(prisma);
    const removed = await prisma.tenant.count({ where: { slug: PILOT_TENANT_SLUG } });
    const afterReset = await prisma.tenant.findMany({ where: { id: { not: PILOT_TENANT_ID } }, select: { id: true }, orderBy: { id: "asc" } });
    if (removed !== 0 || JSON.stringify(before) !== JSON.stringify(afterReset)) throw new Error("Pilot reset crossed its tenant boundary.");

    await seedPilotTenant(prisma);
    const restored = await verifyPilotTenant(prisma);
    process.stdout.write(`${JSON.stringify({ status: "PASS", idempotentCounts: second.counts, unrelatedTenantIdsPreserved: before.length, restored: restored.tenant.slug }, null, 2)}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Pilot boundary verification failed."}\n`);
  process.exitCode = 1;
});
