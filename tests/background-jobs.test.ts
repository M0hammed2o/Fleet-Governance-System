import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { runJob, JobAlreadyRunningError } from "@/lib/jobs/run-job";
import { authorizeJobRequest, InvalidServiceTokenError, ServiceAuthNotConfiguredError } from "@/lib/jobs/service-auth";
import { expireOldExportRequests, reportArchiveUsageForAllTenants } from "@/lib/repositories/retention-repository";
import { expireDueSupportAccessSessions } from "@/lib/repositories/support-access-repository";
import { recalculateStorageUsageSummaries } from "@/lib/repositories/storage-dashboard-repository";
import { NoOpStorageBillingHookProvider, type StorageBillingUsageReport } from "@/lib/retention/storage-billing-hook";
import { createTenant, createRole, createUser, createDriver } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

describe("8E-004: runJob — concurrency, bookkeeping, failure logging", () => {
  it("records a SUCCEEDED JobRun with the job's return value as resultSummary", async () => {
    const jobName = `test.succeeds.${unique()}`;
    const result = await runJob(jobName, async () => ({ processed: 3 }));
    expect(result).toEqual({ processed: 3 });

    const run = await prisma.jobRun.findFirstOrThrow({ where: { jobName } });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.resultSummary).toEqual({ processed: 3 });
    expect(run.finishedAt).not.toBeNull();
  });

  it("records a FAILED JobRun with the error message, and rethrows", async () => {
    const jobName = `test.fails.${unique()}`;
    await expect(
      runJob(jobName, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const run = await prisma.jobRun.findFirstOrThrow({ where: { jobName } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toBe("boom");
  });

  it("refuses to start a second run of the same jobName while one is already RUNNING (hard DB guarantee, not best-effort)", async () => {
    const jobName = `test.concurrent.${unique()}`;
    // Simulates an in-flight run — the partial unique index on JobRun
    // (status = 'RUNNING') is what actually enforces this, not application
    // logic, so a directly-inserted RUNNING row is just as effective as a
    // real overlapping async call at proving the guarantee.
    await prisma.jobRun.create({ data: { jobName, status: "RUNNING" } });

    await expect(runJob(jobName, async () => "should not run")).rejects.toBeInstanceOf(JobAlreadyRunningError);

    const runs = await prisma.jobRun.findMany({ where: { jobName } });
    expect(runs).toHaveLength(1); // the second attempt never created a row
  });

  it("allows a fresh run of the same jobName once the previous one is no longer RUNNING", async () => {
    const jobName = `test.sequential.${unique()}`;
    await runJob(jobName, async () => "first");
    const second = await runJob(jobName, async () => "second");
    expect(second).toBe("second");

    const runs = await prisma.jobRun.findMany({ where: { jobName } });
    expect(runs).toHaveLength(2);
  });
});

describe("8E-004: authorizeJobRequest — service-token and session fallback", () => {
  const originalToken = process.env.JOB_SCHEDULER_TOKEN;

  it("fails closed when JOB_SCHEDULER_TOKEN is not configured, even with a token header present", async () => {
    delete process.env.JOB_SCHEDULER_TOKEN;
    const request = new Request("http://localhost/api/jobs/x", { headers: { "x-job-scheduler-token": "anything" } });
    await expect(authorizeJobRequest(request)).rejects.toBeInstanceOf(ServiceAuthNotConfiguredError);
    if (originalToken !== undefined) process.env.JOB_SCHEDULER_TOKEN = originalToken;
  });

  it("rejects an incorrect token when one is configured", async () => {
    process.env.JOB_SCHEDULER_TOKEN = "correct-token";
    const request = new Request("http://localhost/api/jobs/x", { headers: { "x-job-scheduler-token": "wrong-token" } });
    await expect(authorizeJobRequest(request)).rejects.toBeInstanceOf(InvalidServiceTokenError);
    if (originalToken !== undefined) process.env.JOB_SCHEDULER_TOKEN = originalToken;
    else delete process.env.JOB_SCHEDULER_TOKEN;
  });

  it("accepts the correct token without requiring any user session", async () => {
    process.env.JOB_SCHEDULER_TOKEN = "correct-token";
    const request = new Request("http://localhost/api/jobs/x", { headers: { "x-job-scheduler-token": "correct-token" } });
    await expect(authorizeJobRequest(request)).resolves.toBeUndefined();
    if (originalToken !== undefined) process.env.JOB_SCHEDULER_TOKEN = originalToken;
    else delete process.env.JOB_SCHEDULER_TOKEN;
  });
});

describe("8E-004: individual job repository functions", () => {
  it("expireOldExportRequests marks only past-expiry PENDING/READY requests as EXPIRED, scoped to one tenant", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const past = await prisma.exportRequest.create({
      data: { tenantId: tenant.id, categories: [], requestedByUserId: actor.id, status: "READY", expiresAt: new Date(Date.now() - 1000) },
    });
    const future = await prisma.exportRequest.create({
      data: { tenantId: tenant.id, categories: [], requestedByUserId: actor.id, status: "READY", expiresAt: new Date(Date.now() + 100000) },
    });

    const result = await expireOldExportRequests(new Date(), tenant.id);
    expect(result.expiredCount).toBe(1);

    const updatedPast = await prisma.exportRequest.findUniqueOrThrow({ where: { id: past.id } });
    const updatedFuture = await prisma.exportRequest.findUniqueOrThrow({ where: { id: future.id } });
    expect(updatedPast.status).toBe("EXPIRED");
    expect(updatedFuture.status).toBe("READY");
  });

  it("reportArchiveUsageForAllTenants reports only tenants with archived bytes > 0, never a phantom zero-byte report", async () => {
    const tenantWithArchive = await createTenant();
    const actor = await makeActor(tenantWithArchive.id);
    const driver = await createDriver(tenantWithArchive.id);
    await prisma.mediaAsset.create({
      data: {
        tenantId: tenantWithArchive.id,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver.id,
        capturedByUserId: actor.id,
        fileName: "archived.jpg",
        contentType: "image/webp",
        fileSizeBytes: 5000,
        storageKey: `archived/${unique()}`,
        checksumSha256: crypto.randomBytes(32).toString("hex"),
        idempotencyKey: unique(),
        category: "OTHER_DOCUMENT",
        uploadStatus: "READY",
        retentionStatus: "ARCHIVED",
      },
    });

    const tenantWithoutArchive = await createTenant();

    const reports: StorageBillingUsageReport[] = [];
    class RecordingBillingHook extends NoOpStorageBillingHookProvider {
      async reportUsage(report: StorageBillingUsageReport): Promise<void> {
        reports.push(report);
      }
    }

    await reportArchiveUsageForAllTenants(new RecordingBillingHook(), new Date(), tenantWithArchive.id);
    expect(reports).toHaveLength(1);
    expect(reports[0].tenantId).toBe(tenantWithArchive.id);
    expect(reports[0].archivedBytes).toBe(5000);

    reports.length = 0;
    await reportArchiveUsageForAllTenants(new RecordingBillingHook(), new Date(), tenantWithoutArchive.id);
    expect(reports).toHaveLength(0);
  });

  it("expireDueSupportAccessSessions closes out only sessions whose TTL has lapsed, scoped to one customer tenant", async () => {
    const platformTenant = await createTenant("Platform-like");
    const customerTenant = await createTenant("Customer");
    const actor = await makeActor(platformTenant.id);

    const expiredSession = await prisma.supportAccessSession.create({
      data: {
        tenantId: platformTenant.id,
        actorUserId: actor.id,
        customerTenantId: customerTenant.id,
        reason: "test",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const activeSession = await prisma.supportAccessSession.create({
      data: {
        tenantId: platformTenant.id,
        actorUserId: actor.id,
        customerTenantId: customerTenant.id,
        reason: "test",
        expiresAt: new Date(Date.now() + 100000),
      },
    });

    const result = await expireDueSupportAccessSessions(new Date(), customerTenant.id);
    expect(result.expiredCount).toBe(1);

    const updatedExpired = await prisma.supportAccessSession.findUniqueOrThrow({ where: { id: expiredSession.id } });
    const updatedActive = await prisma.supportAccessSession.findUniqueOrThrow({ where: { id: activeSession.id } });
    expect(updatedExpired.endedAt).not.toBeNull();
    expect(updatedActive.endedAt).toBeNull();
  });

  it("recalculateStorageUsageSummaries recomputes without error and reports at least the tenants that exist", async () => {
    await createTenant();
    const result = await recalculateStorageUsageSummaries();
    expect(result.tenantsProcessed).toBeGreaterThanOrEqual(1);
  });
});
