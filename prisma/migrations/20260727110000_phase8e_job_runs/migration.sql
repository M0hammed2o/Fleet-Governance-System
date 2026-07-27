-- Phase 8E-004: background job architecture — run bookkeeping + hard concurrency guarantee.

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_jobName_startedAt_idx" ON "job_runs"("jobName", "startedAt");

-- Hard concurrency guarantee (8E-004): at most one RUNNING row per jobName,
-- enforced by Postgres itself via a partial unique index — not expressible
-- in Prisma's schema DSL (`@@unique` has no `WHERE` clause), so it is
-- applied here directly. A second concurrent attempt to start the same job
-- collides on this constraint (surfaced to the application as a unique-
-- constraint violation, mapped to JobAlreadyRunningError — see
-- lib/jobs/run-job.ts), not a race between an application-level check and
-- a subsequent insert.
CREATE UNIQUE INDEX "job_runs_one_running_per_job_name" ON "job_runs"("jobName") WHERE "status" = 'RUNNING';
