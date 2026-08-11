import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { logger, redactForLogging } from "@/lib/observability/logger";

export class JobAlreadyRunningError extends Error {
  constructor(jobName: string) {
    super(`Job "${jobName}" is already running.`);
    this.name = "JobAlreadyRunningError";
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

/**
 * Runs one background job (8E-004) with:
 *   - a hard concurrency guarantee (the partial unique index on JobRun —
 *     see schema.prisma's own comment — turns a second overlapping
 *     invocation into a real constraint violation, caught here and raised
 *     as JobAlreadyRunningError, never a silent double-run)
 *   - a JobRun audit record: RUNNING at start, then SUCCEEDED (with the
 *     job's own return value as resultSummary) or FAILED (with the error
 *     message) at the end
 *
 * "Retry" for these jobs means "safe to invoke again on the next scheduled
 * tick" — each job function is itself idempotent (see each one's own
 * comment), so this wrapper does not need to re-invoke `fn` itself; a
 * failed run just leaves whatever was incomplete eligible for the next
 * tick to pick back up.
 */
export async function runJob<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let run: { id: string };
  try {
    run = await prisma.jobRun.create({ data: { jobName, status: "RUNNING" } });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new JobAlreadyRunningError(jobName);
    throw err;
  }

  try {
    logger.info("job.started", { jobName, jobRunId: run.id });
    const result = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: new Date(), resultSummary: (result ?? null) as Prisma.InputJsonValue },
    });
    logger.info("job.succeeded", { jobName, jobRunId: run.id, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    const safeError = redactForLogging(err instanceof Error ? err.message : "unknown error") as string;
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: safeError },
    });
    logger.error("job.failed", { jobName, jobRunId: run.id, durationMs: Date.now() - startedAt, error: err });
    throw err;
  }
}
