import "server-only";
import { runJob } from "@/lib/jobs/run-job";
import { generateDueRetentionNotifications, deliverPendingRetentionNotifications } from "@/lib/repositories/retention-notification-repository";
import { completeDueDeletionRequests, expireOldExportRequests, reportArchiveUsageForAllTenants } from "@/lib/repositories/retention-repository";
import { cleanupFailedUploads } from "@/lib/repositories/media-asset-repository";
import { expireDueSupportAccessSessions } from "@/lib/repositories/support-access-repository";
import { recalculateStorageUsageSummaries } from "@/lib/repositories/storage-dashboard-repository";
import { runRecurringBillingCycle } from "@/lib/repositories/recurring-billing-repository";
import { retryFailedInvestigationNotifications, notifyOverdueInvestigationTasks, notifyExpiringExternalAccess } from "@/lib/repositories/investigation-notification-repository";
import { calculateAnalyticsForAllTenants } from "@/lib/repositories/analytics-calculation-repository";

/**
 * The full list of idempotent background jobs this platform needs (8E-004),
 * each a plain callable async function wrapped in runJob() for concurrency
 * protection, run-result logging, and failure logging. A production
 * scheduler (whichever the business selects — no vendor chosen yet, see
 * TODO.md) invokes these through the matching route under
 * src/app/api/jobs/*, authorized via lib/jobs/service-auth.ts. Locally,
 * `npm run job -- <name>` (scripts/run-job.mjs) calls the same functions
 * directly, no HTTP involved.
 */

export const JOB_NAMES = [
  "retention.generateNotifications",
  "retention.deliverNotifications",
  "retention.completeDueDeletions",
  "media.cleanupFailedUploads",
  "retention.expireExportLinks",
  "retention.reportArchiveUsage",
  "supportAccess.expireDueSessions",
  "storage.recalculateUsageSummaries",
  "billing.runRecurringCycle",
  "investigation.retryFailedNotifications",
  "investigation.notifyOverdueTasks",
  "investigation.notifyExpiringExternalAccess",
  "analytics.calculateIndicators",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function generateRetentionNotificationsJob() {
  return runJob("retention.generateNotifications", () => generateDueRetentionNotifications());
}

export function deliverRetentionNotificationsJob() {
  return runJob("retention.deliverNotifications", () => deliverPendingRetentionNotifications());
}

export function completeDueDeletionRequestsJob() {
  return runJob("retention.completeDueDeletions", async () => {
    const certificates = await completeDueDeletionRequests();
    return { completedCount: certificates.length };
  });
}

export function cleanupFailedUploadsJob() {
  return runJob("media.cleanupFailedUploads", () => cleanupFailedUploads());
}

export function expireExportLinksJob() {
  return runJob("retention.expireExportLinks", () => expireOldExportRequests());
}

export function reportArchiveUsageJob() {
  return runJob("retention.reportArchiveUsage", () => reportArchiveUsageForAllTenants());
}

export function expireSupportAccessSessionsJob() {
  return runJob("supportAccess.expireDueSessions", () => expireDueSupportAccessSessions());
}

export function recalculateStorageUsageSummariesJob() {
  return runJob("storage.recalculateUsageSummaries", () => recalculateStorageUsageSummaries());
}

export function runRecurringBillingCycleJob() {
  return runJob("billing.runRecurringCycle", () => runRecurringBillingCycle());
}

export function retryFailedInvestigationNotificationsJob() {
  return runJob("investigation.retryFailedNotifications", () => retryFailedInvestigationNotifications());
}

export function notifyOverdueInvestigationTasksJob() {
  return runJob("investigation.notifyOverdueTasks", () => notifyOverdueInvestigationTasks());
}

export function notifyExpiringExternalAccessJob() {
  return runJob("investigation.notifyExpiringExternalAccess", () => notifyExpiringExternalAccess());
}

export function calculateAnalyticsIndicatorsJob() {
  return runJob("analytics.calculateIndicators", () => calculateAnalyticsForAllTenants());
}

export const JOB_FUNCTIONS: Record<JobName, () => Promise<unknown>> = {
  "retention.generateNotifications": generateRetentionNotificationsJob,
  "retention.deliverNotifications": deliverRetentionNotificationsJob,
  "retention.completeDueDeletions": completeDueDeletionRequestsJob,
  "media.cleanupFailedUploads": cleanupFailedUploadsJob,
  "retention.expireExportLinks": expireExportLinksJob,
  "retention.reportArchiveUsage": reportArchiveUsageJob,
  "supportAccess.expireDueSessions": expireSupportAccessSessionsJob,
  "storage.recalculateUsageSummaries": recalculateStorageUsageSummariesJob,
  "billing.runRecurringCycle": runRecurringBillingCycleJob,
  "investigation.retryFailedNotifications": retryFailedInvestigationNotificationsJob,
  "investigation.notifyOverdueTasks": notifyOverdueInvestigationTasksJob,
  "investigation.notifyExpiringExternalAccess": notifyExpiringExternalAccessJob,
  "analytics.calculateIndicators": calculateAnalyticsIndicatorsJob,
};
