import { config } from "dotenv";
import { resetPilotTenant, seedPilotTenant, verifyPilotTenant, withPilotClient } from "../src/lib/pilot/pilot-dataset";

config({ path: ".env", quiet: true });
const mode = process.argv[2] ?? "seed";

async function main() {
  await withPilotClient(async (prisma) => {
    if (mode === "seed") {
      await seedPilotTenant(prisma);
      process.stdout.write(`${JSON.stringify(await verifyPilotTenant(prisma), null, 2)}\n`);
      return;
    }
    if (mode === "reset") {
      const removed = await resetPilotTenant(prisma);
      process.stdout.write(`${removed ? "Synthetic pilot tenant reset." : "Synthetic pilot tenant was not present."}\n`);
      return;
    }
    if (mode === "verify") {
      process.stdout.write(`${JSON.stringify(await verifyPilotTenant(prisma), null, 2)}\n`);
      return;
    }
    throw new Error("Usage: tsx prisma/pilot-seed.ts seed|reset|verify");
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Pilot operation failed."}\n`);
  process.exitCode = 1;
});
