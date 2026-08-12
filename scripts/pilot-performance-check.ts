import { performance } from "node:perf_hooks";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PILOT_TENANT_SLUG } from "../src/lib/pilot/pilot-safety";
import { verifyPilotTenant } from "../src/lib/pilot/pilot-dataset";

const timings: Array<{ operation: string; milliseconds: number; rows: number }> = [];

async function measure<T extends unknown[]>(operation: string, query: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await query();
  timings.push({ operation, milliseconds: Number((performance.now() - started).toFixed(2)), rows: result.length });
  return result;
}

async function measureValue<T>(operation: string, query: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await query();
  timings.push({ operation, milliseconds: Number((performance.now() - started).toFixed(2)), rows: 1 });
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
  const tenants = await measure("exact synthetic pilot tenant", () => prisma.tenant.findMany({ where: { slug: PILOT_TENANT_SLUG }, select: { id: true, slug: true }, take: 1 }));
  const tenantId = tenants[0]?.id;
  if (!tenantId) throw new Error("Seed a synthetic local tenant before running the performance check.");

  const [vehicles, drivers, movements, gateEvents, investigations, indicators, exceptions, reconciliations, documents, media] = await Promise.all([
    measure("vehicles", () => prisma.vehicle.findMany({ where: { tenantId }, select: { id: true }, orderBy: { id: "asc" }, take: 100 })),
    measure("drivers", () => prisma.driver.findMany({ where: { tenantId }, select: { id: true }, orderBy: { id: "asc" }, take: 100 })),
    measure("movements", () => prisma.movementAuthorisation.findMany({ where: { tenantId }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 100 })),
    measure("gate events", () => prisma.gateEvent.findMany({ where: { tenantId }, select: { id: true }, orderBy: { startedAt: "desc" }, take: 100 })),
    measure("investigations", () => prisma.investigationCase.findMany({ where: { tenantId }, select: { id: true }, orderBy: { updatedAt: "desc" }, take: 100 })),
    measure("analytics indicators", () => prisma.analyticsIndicator.findMany({ where: { tenantId }, select: { id: true }, orderBy: { lastDetectedAt: "desc" }, take: 100 })),
    measure("exception list", () => prisma.exception.findMany({ where: { tenantId }, select: { id: true }, orderBy: { raisedAt: "desc" }, take: 100 })),
    measure("reconciliations", () => prisma.reconciliation.findMany({ where: { tenantId }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 100 })),
    measure("report/export source documents", () => prisma.complianceDocument.findMany({ where: { tenantId }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 100 })),
    measure("media metadata", () => prisma.mediaAsset.findMany({ where: { tenantId }, select: { id: true }, orderBy: { capturedAt: "desc" }, take: 200 })),
  ]);
  await measureValue("pilot invariant verification", () => verifyPilotTenant(prisma));

  process.stdout.write(`${JSON.stringify({
    target: "validated local PostgreSQL",
    dataset: { tenants: tenants.length, vehicles: vehicles.length, drivers: drivers.length, movements: movements.length, gateEvents: gateEvents.length, investigations: investigations.length, indicators: indicators.length, exceptions: exceptions.length, reconciliations: reconciliations.length, documents: documents.length, mediaAssets: media.length },
    timings,
    limitation: "Bounded single-process local data timings are regression signals only. Browser rendering, PDF/CSV generation and hosted concurrency still require environment-specific load testing.",
  }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Performance check failed."}\n`);
  process.exitCode = 1;
});
