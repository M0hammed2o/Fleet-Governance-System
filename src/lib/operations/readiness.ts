import "server-only";
import { prisma } from "@/lib/db/prisma";
import { buildProductionReadinessReport, type ProductionReadinessReport } from "@/lib/operations/readiness-core";
import { SCHEDULED_JOB_MANIFEST } from "@/lib/operations/job-manifest";

export async function checkDatabaseReadiness(timeoutMs = 3_000): Promise<"READY" | "UNAVAILABLE"> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1 AS ready`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("database readiness timeout")), timeoutMs);
      }),
    ]);
    return "READY";
  } catch {
    return "UNAVAILABLE";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getProductionReadinessReport(): Promise<ProductionReadinessReport> {
  const database = await checkDatabaseReadiness();
  return buildProductionReadinessReport(process.env, { database });
}

export interface JobDiagnostic {
  name: string;
  cadence: string;
  owner: string;
  lastStatus: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
}

export async function getJobDiagnostics(): Promise<JobDiagnostic[]> {
  const recent = await prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 200,
    select: { jobName: true, status: true, startedAt: true, finishedAt: true },
  });
  const latest = new Map<string, (typeof recent)[number]>();
  for (const run of recent) if (!latest.has(run.jobName)) latest.set(run.jobName, run);
  return SCHEDULED_JOB_MANIFEST.map((definition) => {
    const run = latest.get(definition.name);
    return {
      name: definition.name,
      cadence: definition.cadence,
      owner: definition.owner,
      lastStatus: run?.status ?? null,
      lastStartedAt: run?.startedAt.toISOString() ?? null,
      lastFinishedAt: run?.finishedAt?.toISOString() ?? null,
    };
  });
}
