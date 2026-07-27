import "server-only";
import { prisma } from "@/lib/db/prisma";
import { currentRetentionMilestone } from "@/lib/retention/deletion-rules";
import {
  DevConsoleRetentionNotificationProvider,
  NoOpRetentionNotificationProvider,
  type RetentionNotificationBatch,
  type RetentionNotificationProvider,
} from "@/lib/retention/notification-provider";
import type { MediaCategory, RetentionNotificationChannel } from "@/generated/prisma/client";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

// Presented in every retention-expiry notice — none of these reveal the
// evidence's content, only what the customer-admin may do about the
// upcoming expiry from the retention dashboard (8E-003 "without exposing
// restricted evidence through email").
export const RETENTION_NOTIFICATION_AVAILABLE_ACTIONS = [
  "Extend retention",
  "Move to archive storage",
  "Export before deletion",
  "Request early deletion",
] as const;

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

export interface GenerateRetentionNotificationsResult {
  createdCount: number;
  skippedCount: number;
}

/**
 * Scans every ACTIVE MediaAsset with a non-null scheduledDeletionAt within
 * the next 90 days and, for whichever 90/60/30/7/0-day milestone currently
 * applies, ensures exactly one RetentionNotificationRecord exists for that
 * (mediaAssetId, milestone, scheduledDeletionAt) combination. Safe to call
 * repeatedly (a scheduler re-running this, or two overlapping invocations) —
 * the unique index on the table is the actual source of truth for
 * "already generated"; a P2002 here is the expected, harmless outcome of a
 * duplicate attempt, not an error.
 */
export async function generateDueRetentionNotifications(now: Date = new Date(), tenantId?: string): Promise<GenerateRetentionNotificationsResult> {
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * MILLIS_PER_DAY);
  const assets = await prisma.mediaAsset.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      retentionStatus: "ACTIVE",
      scheduledDeletionAt: { not: null, gte: now, lte: ninetyDaysFromNow },
    },
    select: { id: true, tenantId: true, scheduledDeletionAt: true },
  });

  let createdCount = 0;
  let skippedCount = 0;
  for (const asset of assets) {
    const milestone = currentRetentionMilestone(asset.scheduledDeletionAt!, now);
    if (milestone === null) continue;
    try {
      await prisma.retentionNotificationRecord.create({
        data: {
          tenantId: asset.tenantId,
          mediaAssetId: asset.id,
          milestone,
          scheduledDeletionAt: asset.scheduledDeletionAt!,
        },
      });
      createdCount++;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        skippedCount++;
        continue;
      }
      throw err;
    }
  }

  return { createdCount, skippedCount };
}

export interface DeliverRetentionNotificationsResult {
  batchesAttempted: number;
  batchesDelivered: number;
  batchesFailed: number;
  recordsUpdated: number;
}

interface PendingRecordWithAsset {
  id: string;
  tenantId: string;
  milestone: number;
  scheduledDeletionAt: Date;
  mediaAsset: { category: MediaCategory; fileSizeBytes: number };
}

function groupKey(tenantId: string, category: MediaCategory, milestone: number): string {
  return `${tenantId}::${category}::${milestone}`;
}

/**
 * Delivers every PENDING or previously-FAILED RetentionNotificationRecord —
 * FAILED is included so a transient provider failure gets retried on the
 * next scheduled run, not stuck forever (8E-004 "retry handling"). Groups
 * records by (tenant, category, milestone) into one RetentionNotificationBatch
 * per group so a tenant crossing a milestone on many assets at once gets one
 * message, not one per asset — every member record in a group is updated
 * together with that group's single delivery outcome.
 */
export async function deliverPendingRetentionNotifications(
  provider: RetentionNotificationProvider = new DevConsoleRetentionNotificationProvider(),
  now: Date = new Date(),
  tenantId?: string,
): Promise<DeliverRetentionNotificationsResult> {
  const pending = (await prisma.retentionNotificationRecord.findMany({
    where: { ...(tenantId ? { tenantId } : {}), status: { in: ["PENDING", "FAILED"] } },
    include: { mediaAsset: { select: { category: true, fileSizeBytes: true } } },
  })) as PendingRecordWithAsset[];

  const groups = new Map<string, PendingRecordWithAsset[]>();
  for (const record of pending) {
    const key = groupKey(record.tenantId, record.mediaAsset.category, record.milestone);
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  let batchesDelivered = 0;
  let batchesFailed = 0;
  let recordsUpdated = 0;

  for (const records of groups.values()) {
    const first = records[0];
    const scheduledDates = records.map((r) => r.scheduledDeletionAt.getTime());
    const batch: RetentionNotificationBatch = {
      tenantId: first.tenantId,
      category: first.mediaAsset.category,
      milestone: first.milestone as RetentionNotificationBatch["milestone"],
      scheduledDeletionRangeStart: new Date(Math.min(...scheduledDates)),
      scheduledDeletionRangeEnd: new Date(Math.max(...scheduledDates)),
      totalBytes: records.reduce((sum, r) => sum + r.mediaAsset.fileSizeBytes, 0),
      assetCount: records.length,
      availableActions: [...RETENTION_NOTIFICATION_AVAILABLE_ACTIONS],
    };

    let result: { delivered: boolean; failureReason?: string };
    try {
      result = await provider.send(batch);
    } catch (err) {
      result = { delivered: false, failureReason: err instanceof Error ? err.message : "unknown delivery error" };
    }

    if (result.delivered) batchesDelivered++;
    else batchesFailed++;

    const channel = provider.channel satisfies RetentionNotificationChannel;
    await prisma.retentionNotificationRecord.updateMany({
      where: { id: { in: records.map((r) => r.id) } },
      data: result.delivered
        ? { status: "SENT", channel, attemptedAt: now, deliveredAt: now, failureReason: null }
        : { status: "FAILED", channel, attemptedAt: now, failureReason: result.failureReason ?? "delivery failed" },
    });
    recordsUpdated += records.length;
  }

  return { batchesAttempted: groups.size, batchesDelivered, batchesFailed, recordsUpdated };
}

export { NoOpRetentionNotificationProvider, DevConsoleRetentionNotificationProvider };
