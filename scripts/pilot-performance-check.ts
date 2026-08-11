import { performance } from "node:perf_hooks";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const timings: Array<{ operation: string; milliseconds: number; rows: number }> = [];

async function measure<T extends unknown[]>(operation: string, query: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await query();
  timings.push({ operation, milliseconds: Number((performance.now() - started).toFixed(2)), rows: result.length });
  return result;
}

async function main() {
  config({ path: ".env", quiet: true });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const target = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) throw new Error("Performance checks are restricted to a loopback database.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
  const tenants = await measure("pilot tenants", () => prisma.tenant.findMany({ where: { slug: { not: "platform" } }, select: { id: true, slug: true }, orderBy: { id: "asc" }, take: 10 }));
  const tenantId = tenants[0]?.id;
  if (!tenantId) throw new Error("Seed a synthetic local tenant before running the performance check.");

  const [vehicles, movements, gateEvents, investigations, indicators, media] = await Promise.all([
    measure("vehicles", () => prisma.vehicle.findMany({ where: { tenantId }, select: { id: true }, orderBy: { id: "asc" }, take: 100 })),
    measure("movements", () => prisma.movementAuthorisation.findMany({ where: { tenantId }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 100 })),
    measure("gate events", () => prisma.gateEvent.findMany({ where: { tenantId }, select: { id: true }, orderBy: { startedAt: "desc" }, take: 100 })),
    measure("investigations", () => prisma.investigationCase.findMany({ where: { tenantId }, select: { id: true }, orderBy: { updatedAt: "desc" }, take: 100 })),
    measure("analytics indicators", () => prisma.analyticsIndicator.findMany({ where: { tenantId }, select: { id: true }, orderBy: { lastDetectedAt: "desc" }, take: 100 })),
    measure("media metadata", () => prisma.mediaAsset.findMany({ where: { tenantId }, select: { id: true }, orderBy: { capturedAt: "desc" }, take: 200 })),
  ]);

  process.stdout.write(`${JSON.stringify({
    target: "validated local PostgreSQL",
    dataset: { tenants: tenants.length, vehicles: vehicles.length, movements: movements.length, gateEvents: gateEvents.length, investigations: investigations.length, indicators: indicators.length, mediaAssets: media.length },
    timings,
    limitation: "Single-process local timings are a regression signal only and are not a production capacity claim.",
  }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Performance check failed."}\n`);
  process.exitCode = 1;
});
