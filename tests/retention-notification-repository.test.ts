import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  generateDueRetentionNotifications,
  deliverPendingRetentionNotifications,
  RETENTION_NOTIFICATION_AVAILABLE_ACTIONS,
} from "@/lib/repositories/retention-notification-repository";
import { NoOpRetentionNotificationProvider } from "@/lib/retention/notification-provider";
import type { RetentionNotificationBatch, RetentionNotificationProvider, RetentionNotificationDeliveryResult } from "@/lib/retention/notification-provider";
import { createTenant, createRole, createUser, createDriver } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

async function createAssetWithScheduledDeletion(tenantId: string, actorUserId: string, driverId: string, scheduledDeletionAt: Date, category: "DRIVER_PORTRAIT" | "OTHER_DOCUMENT" = "OTHER_DOCUMENT") {
  return prisma.mediaAsset.create({
    data: {
      tenantId,
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driverId,
      capturedByUserId: actorUserId,
      capturedAt: new Date(),
      fileName: "evidence.jpg",
      contentType: "image/webp",
      fileSizeBytes: 1024,
      storageKey: `notif/${unique()}`,
      checksumSha256: crypto.randomBytes(32).toString("hex"),
      idempotencyKey: unique(),
      category,
      uploadStatus: "READY",
      retentionStatus: "ACTIVE",
      scheduledDeletionAt,
    },
  });
}

class RecordingProvider implements RetentionNotificationProvider {
  readonly channel = "NOOP" as const;
  sentBatches: RetentionNotificationBatch[] = [];
  private readonly outcome: RetentionNotificationDeliveryResult;

  constructor(outcome: RetentionNotificationDeliveryResult = { delivered: true }) {
    this.outcome = outcome;
  }

  async send(batch: RetentionNotificationBatch): Promise<RetentionNotificationDeliveryResult> {
    this.sentBatches.push(batch);
    return this.outcome;
  }
}

describe("8E-003: generateDueRetentionNotifications is idempotent", () => {
  it("creates exactly one record per (asset, milestone, scheduledDeletionAt) and is a no-op on re-run", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const now = new Date("2026-01-01T00:00:00Z");
    const scheduledDeletionAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days out -> milestone 7
    const asset = await createAssetWithScheduledDeletion(tenant.id, actor.id, driver.id, scheduledDeletionAt);

    const first = await generateDueRetentionNotifications(now, tenant.id);
    expect(first.createdCount).toBeGreaterThanOrEqual(1);

    const records = await prisma.retentionNotificationRecord.findMany({ where: { mediaAssetId: asset.id } });
    expect(records).toHaveLength(1);
    expect(records[0].milestone).toBe(7);
    expect(records[0].status).toBe("PENDING");

    // Re-running must not create a duplicate for the same milestone+date.
    const second = await generateDueRetentionNotifications(now, tenant.id);
    expect(second.createdCount).toBe(0);
    expect(second.skippedCount).toBeGreaterThanOrEqual(1);

    const recordsAfter = await prisma.retentionNotificationRecord.findMany({ where: { mediaAssetId: asset.id } });
    expect(recordsAfter).toHaveLength(1);
  });

  it("generates a fresh notification when the scheduled deletion date genuinely changes (e.g. an extension)", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const now = new Date("2026-02-01T00:00:00Z");
    const firstDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const asset = await createAssetWithScheduledDeletion(tenant.id, actor.id, driver.id, firstDate);

    await generateDueRetentionNotifications(now, tenant.id);
    const afterFirst = await prisma.retentionNotificationRecord.findMany({ where: { mediaAssetId: asset.id } });
    expect(afterFirst).toHaveLength(1);

    const secondDate = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000); // still milestone 7, different exact date
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { scheduledDeletionAt: secondDate } });
    await generateDueRetentionNotifications(now, tenant.id);

    const afterSecond = await prisma.retentionNotificationRecord.findMany({ where: { mediaAssetId: asset.id } });
    expect(afterSecond).toHaveLength(2); // one per distinct scheduledDeletionAt, both milestone 7
  });
});

describe("8E-003: deliverPendingRetentionNotifications", () => {
  it("groups same-tenant/category/milestone records into one batch, includes category/date-range/storage/actions, and marks all members SENT", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const now = new Date("2026-03-01T00:00:00Z");
    const d1 = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const d2 = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const assetA = await createAssetWithScheduledDeletion(tenant.id, actor.id, driver.id, d1, "OTHER_DOCUMENT");
    const assetB = await createAssetWithScheduledDeletion(tenant.id, actor.id, driver.id, d2, "OTHER_DOCUMENT");

    await generateDueRetentionNotifications(now, tenant.id);

    const provider = new RecordingProvider({ delivered: true });
    const result = await deliverPendingRetentionNotifications(provider, now, tenant.id);

    expect(result.batchesAttempted).toBe(1); // same tenant+category+milestone -> one batch
    expect(result.batchesDelivered).toBe(1);
    expect(provider.sentBatches).toHaveLength(1);

    const batch = provider.sentBatches[0];
    expect(batch.tenantId).toBe(tenant.id);
    expect(batch.category).toBe("OTHER_DOCUMENT");
    expect(batch.milestone).toBe(7);
    expect(batch.assetCount).toBe(2);
    expect(batch.totalBytes).toBe(2048);
    expect(batch.availableActions).toEqual([...RETENTION_NOTIFICATION_AVAILABLE_ACTIONS]);
    expect(batch.scheduledDeletionRangeStart.getTime()).toBe(d1.getTime());
    expect(batch.scheduledDeletionRangeEnd.getTime()).toBe(d2.getTime());

    const recordA = await prisma.retentionNotificationRecord.findFirstOrThrow({ where: { mediaAssetId: assetA.id } });
    const recordB = await prisma.retentionNotificationRecord.findFirstOrThrow({ where: { mediaAssetId: assetB.id } });
    expect(recordA.status).toBe("SENT");
    expect(recordB.status).toBe("SENT");
    expect(recordA.deliveredAt).not.toBeNull();
    expect(recordA.channel).toBe("NOOP");
  });

  it("marks records FAILED with a reason when the provider reports failure, and does not re-deliver an already-SENT record", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const now = new Date("2026-04-01T00:00:00Z");
    const scheduledDeletionAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const asset = await createAssetWithScheduledDeletion(tenant.id, actor.id, driver.id, scheduledDeletionAt);
    await generateDueRetentionNotifications(now, tenant.id);

    const failingProvider = new RecordingProvider({ delivered: false, failureReason: "smtp unavailable" });
    const failResult = await deliverPendingRetentionNotifications(failingProvider, now, tenant.id);
    expect(failResult.batchesFailed).toBe(1);

    const afterFail = await prisma.retentionNotificationRecord.findFirstOrThrow({ where: { mediaAssetId: asset.id } });
    expect(afterFail.status).toBe("FAILED");
    expect(afterFail.failureReason).toBe("smtp unavailable");
    expect(afterFail.attemptCount).toBe(1);

    // A retry (e.g. next scheduled run) picks up the FAILED record and can succeed.
    const retryProvider = new RecordingProvider({ delivered: true });
    const retryResult = await deliverPendingRetentionNotifications(retryProvider, now, tenant.id);
    expect(retryResult.batchesAttempted).toBe(1);
    expect(retryResult.batchesDelivered).toBe(1);

    const afterRetry = await prisma.retentionNotificationRecord.findFirstOrThrow({ where: { mediaAssetId: asset.id } });
    expect(afterRetry.status).toBe("SENT");
    expect(afterRetry.attemptCount).toBe(2);

    // A third run finds nothing left to deliver — SENT is a terminal state.
    const thirdProvider = new RecordingProvider({ delivered: true });
    const thirdResult = await deliverPendingRetentionNotifications(thirdProvider, now, tenant.id);
    expect(thirdResult.batchesAttempted).toBe(0);
  });

  it("the no-op provider always reports delivered without external side effects, for environments that want silence", async () => {
    const provider = new NoOpRetentionNotificationProvider();
    const result = await provider.send({
      tenantId: "t",
      category: "OTHER_DOCUMENT",
      milestone: 30,
      scheduledDeletionRangeStart: new Date(),
      scheduledDeletionRangeEnd: new Date(),
      totalBytes: 0,
      assetCount: 0,
      availableActions: [],
    });
    expect(result.delivered).toBe(true);
  });
});
