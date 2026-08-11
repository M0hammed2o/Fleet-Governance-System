import type { JobName } from "@/lib/jobs/jobs";

export interface ScheduledJobDefinition {
  name: JobName;
  route: string;
  cadence: string;
  expectedMaximumMinutes: number;
  overlapPolicy: "SKIP_WHILE_RUNNING";
  retryPolicy: string;
  owner: string;
  deliveryRisk: "NONE" | "NOOP_UNTIL_PROVIDER_APPROVED";
}

export const SCHEDULED_JOB_MANIFEST: readonly ScheduledJobDefinition[] = [
  { name: "retention.generateNotifications", route: "/api/jobs/retention-notifications/generate", cadence: "daily 01:00 tenant time", expectedMaximumMinutes: 15, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "next scheduled run", owner: "Platform Operations", deliveryRisk: "NONE" },
  { name: "retention.deliverNotifications", route: "/api/jobs/retention-notifications/deliver", cadence: "daily 02:00 tenant time", expectedMaximumMinutes: 15, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "bounded records on next scheduled run", owner: "Platform Operations", deliveryRisk: "NOOP_UNTIL_PROVIDER_APPROVED" },
  { name: "retention.completeDueDeletions", route: "/api/jobs/deletion-requests/complete-due", cadence: "daily 03:00 UTC", expectedMaximumMinutes: 30, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "idempotent next scheduled run", owner: "Information Officer / Platform Operations", deliveryRisk: "NONE" },
  { name: "media.cleanupFailedUploads", route: "/api/jobs/media/cleanup-failed-uploads", cadence: "hourly", expectedMaximumMinutes: 15, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "next scheduled run", owner: "Platform Operations", deliveryRisk: "NONE" },
  { name: "retention.expireExportLinks", route: "/api/jobs/retention/expire-export-links", cadence: "hourly", expectedMaximumMinutes: 10, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "next scheduled run", owner: "Platform Operations", deliveryRisk: "NONE" },
  { name: "retention.reportArchiveUsage", route: "/api/jobs/retention/report-archive-usage", cadence: "daily 04:00 UTC", expectedMaximumMinutes: 15, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "next scheduled run", owner: "Finance / Platform Operations", deliveryRisk: "NONE" },
  { name: "supportAccess.expireDueSessions", route: "/api/jobs/support-access/expire-due-sessions", cadence: "every 5 minutes", expectedMaximumMinutes: 5, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "next scheduled run", owner: "Security Operations", deliveryRisk: "NONE" },
  { name: "storage.recalculateUsageSummaries", route: "/api/jobs/storage/recalculate-usage-summaries", cadence: "daily 04:30 UTC", expectedMaximumMinutes: 20, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "next scheduled run", owner: "Platform Operations", deliveryRisk: "NONE" },
  { name: "billing.runRecurringCycle", route: "/api/jobs/billing/run-recurring-cycle", cadence: "daily 05:00 UTC", expectedMaximumMinutes: 30, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "idempotent next scheduled run", owner: "Finance Operations", deliveryRisk: "NOOP_UNTIL_PROVIDER_APPROVED" },
  { name: "investigation.retryFailedNotifications", route: "/api/jobs/investigations/retry-failed-notifications", cadence: "every 30 minutes", expectedMaximumMinutes: 10, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "bounded delivery policy", owner: "Investigation Operations", deliveryRisk: "NOOP_UNTIL_PROVIDER_APPROVED" },
  { name: "investigation.notifyOverdueTasks", route: "/api/jobs/investigations/notify-overdue-tasks", cadence: "daily 06:00 tenant time", expectedMaximumMinutes: 15, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "idempotency review required before live delivery", owner: "Investigation Manager", deliveryRisk: "NOOP_UNTIL_PROVIDER_APPROVED" },
  { name: "investigation.notifyExpiringExternalAccess", route: "/api/jobs/investigations/notify-expiring-external-access", cadence: "daily 06:30 tenant time", expectedMaximumMinutes: 10, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "existing per-case duplicate suppression", owner: "Investigation Manager", deliveryRisk: "NOOP_UNTIL_PROVIDER_APPROVED" },
  { name: "analytics.calculateIndicators", route: "/api/jobs/analytics/calculate-indicators", cadence: "daily 00:30 tenant time", expectedMaximumMinutes: 30, overlapPolicy: "SKIP_WHILE_RUNNING", retryPolicy: "deterministic keys and cooldown make re-execution safe", owner: "Governance Operations", deliveryRisk: "NONE" },
] as const;
