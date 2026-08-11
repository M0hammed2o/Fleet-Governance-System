// Phase 8E-004 local dev CLI for the background jobs under src/app/api/jobs/*.
//
// Every repository function these jobs call is guarded by `import
// "server-only"` (the standard Next.js marker enforcing that server-only
// code never runs outside a server/route context) — so this script cannot
// import the job functions directly the way scripts/cleanup-test-db-fixtures.mjs
// imports lib/db/prisma.ts (which deliberately carries no such guard). This
// is a boundary this script must respect, not route around: it is a thin
// HTTP client against the already-running dev server's own job routes,
// authenticated the same "production scheduler boundary" way a real
// scheduler would be (lib/jobs/service-auth.ts) — via JOB_SCHEDULER_TOKEN.
//
// Requires `npm run dev` already running in another terminal. Usage:
//   JOB_SCHEDULER_TOKEN=<token> npm run job -- <job-name>
//   npm run job -- --list
import { config } from "dotenv";

config({ path: ".env" });

const BASE_URL = process.env.JOB_CLI_BASE_URL ?? "http://localhost:3000";

const JOB_ROUTES = {
  "retention.generateNotifications": "/api/jobs/retention-notifications/generate",
  "retention.deliverNotifications": "/api/jobs/retention-notifications/deliver",
  "retention.completeDueDeletions": "/api/jobs/deletion-requests/complete-due",
  "media.cleanupFailedUploads": "/api/jobs/media/cleanup-failed-uploads",
  "retention.expireExportLinks": "/api/jobs/retention/expire-export-links",
  "retention.reportArchiveUsage": "/api/jobs/retention/report-archive-usage",
  "supportAccess.expireDueSessions": "/api/jobs/support-access/expire-due-sessions",
  "storage.recalculateUsageSummaries": "/api/jobs/storage/recalculate-usage-summaries",
  "billing.runRecurringCycle": "/api/jobs/billing/run-recurring-cycle",
  "investigation.retryFailedNotifications": "/api/jobs/investigations/retry-failed-notifications",
  "investigation.notifyOverdueTasks": "/api/jobs/investigations/notify-overdue-tasks",
  "investigation.notifyExpiringExternalAccess": "/api/jobs/investigations/notify-expiring-external-access",
  "analytics.calculateIndicators": "/api/jobs/analytics/calculate-indicators",
};

const jobName = process.argv[2];

if (!jobName || jobName === "--list") {
  console.log(`Available jobs:\n${Object.keys(JOB_ROUTES).map((n) => `  ${n}`).join("\n")}`);
  process.exit(jobName ? 0 : 1);
}

const path = JOB_ROUTES[jobName];
if (!path) {
  console.error(`Unknown job "${jobName}". Available: ${Object.keys(JOB_ROUTES).join(", ")}`);
  process.exit(1);
}

if (!process.env.JOB_SCHEDULER_TOKEN) {
  console.error("JOB_SCHEDULER_TOKEN is not set — the job endpoint fails closed without it. Set it in .env or the environment.");
  process.exit(1);
}

try {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "x-job-scheduler-token": process.env.JOB_SCHEDULER_TOKEN },
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(`Job "${jobName}" failed (HTTP ${response.status}):`, JSON.stringify(body));
    process.exit(1);
  }
  console.log(`Job "${jobName}" succeeded:`, JSON.stringify(body, null, 2));
} catch (err) {
  console.error(`Could not reach ${BASE_URL}${path} — is "npm run dev" running? `, err instanceof Error ? err.message : err);
  process.exit(1);
}
