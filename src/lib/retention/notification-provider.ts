import type { MediaCategory } from "@/generated/prisma/client";
import type { RetentionNotificationMilestone } from "./deletion-rules";
import { logger } from "@/lib/observability/logger";

/**
 * One outbound retention-expiry message — grouped by (tenant, category,
 * milestone), never a single MediaAsset (see
 * lib/repositories/retention-notification-repository.ts for why). Never
 * carries a signed URL, a file name, or anything else that would let this
 * message alone reveal the *contents* of restricted evidence (8E-003) — a
 * customer-admin sees the underlying assets by logging into the retention
 * dashboard, not by anything embedded in this notice.
 */
export interface RetentionNotificationBatch {
  tenantId: string;
  category: MediaCategory;
  milestone: RetentionNotificationMilestone;
  scheduledDeletionRangeStart: Date;
  scheduledDeletionRangeEnd: Date;
  totalBytes: number;
  assetCount: number;
  availableActions: string[];
}

export interface RetentionNotificationDeliveryResult {
  delivered: boolean;
  failureReason?: string;
}

/**
 * Provider-neutral boundary (Phase 8E-003) — same "interface + working
 * dev/mock implementation, real vendor deferred" pattern as every other
 * *Provider in this codebase (ObjectStorageProvider, FacialVerificationProvider,
 * TelematicsProvider, StorageBillingHookProvider). No paid email/SMS vendor
 * has been selected or contracted — see INTEGRATIONS.md — so a future
 * `EmailRetentionNotificationProvider` (SES/SendGrid/etc, whichever the
 * business selects) implements this same interface and is a drop-in swap for
 * whichever of the two below is configured today; nothing else in this
 * codebase needs to change.
 */
export interface RetentionNotificationProvider {
  readonly channel: "DEV_CONSOLE" | "NOOP" | "EMAIL";
  send(batch: RetentionNotificationBatch): Promise<RetentionNotificationDeliveryResult>;
}

const GB = 1024 ** 3;

function formatBytes(bytes: number): string {
  return `${(bytes / GB).toFixed(2)}GB`;
}

function formatBatchMessage(batch: RetentionNotificationBatch): string {
  const milestoneLabel = batch.milestone === 0 ? "TODAY" : `in ${batch.milestone} day(s)`;
  return (
    `[retention-notification] Tenant ${batch.tenantId}: ${batch.assetCount} ${batch.category} asset(s) ` +
    `(${formatBytes(batch.totalBytes)}) scheduled for deletion ${milestoneLabel} ` +
    `(between ${batch.scheduledDeletionRangeStart.toISOString()} and ${batch.scheduledDeletionRangeEnd.toISOString()}). ` +
    `Available actions: ${batch.availableActions.join(", ")}.`
  );
}

/** Dev-visible delivery — logs the notification instead of sending real email/SMS (no vendor selected yet). Always "succeeds". */
export class DevConsoleRetentionNotificationProvider implements RetentionNotificationProvider {
  readonly channel = "DEV_CONSOLE" as const;

  async send(batch: RetentionNotificationBatch): Promise<RetentionNotificationDeliveryResult> {
    logger.info("retention.synthetic_notification", { summary: formatBatchMessage(batch) });
    return { delivered: true };
  }
}

/** Silently discards — for environments (e.g. some test runs) where even console output is unwanted noise. Always "succeeds". */
export class NoOpRetentionNotificationProvider implements RetentionNotificationProvider {
  readonly channel = "NOOP" as const;

  async send(batch: RetentionNotificationBatch): Promise<RetentionNotificationDeliveryResult> {
    void batch; // intentionally discarded — see this module's docstring.
    return { delivered: true };
  }
}
