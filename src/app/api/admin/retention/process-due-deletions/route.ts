import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { completeDueDeletionRequestsJob } from "@/lib/jobs/jobs";
import { JobAlreadyRunningError } from "@/lib/jobs/run-job";

/**
 * Cross-tenant batch job: completes every APPROVED deletion request across
 * every tenant whose recovery period has elapsed. Gated by `platformTenant:
 * CONFIGURE` (Platform Administrator only) since it operates across tenant
 * boundaries by design — not a customer-tenant action. Kept as a
 * human-session-callable route for on-demand use by a Platform
 * Administrator; the scheduler-facing equivalent (service-token auth, no
 * human session required) is `POST /api/jobs/deletion-requests/complete-due`
 * — both now route through the same `completeDueDeletionRequestsJob()`
 * (8E-004), so either entry point produces the same JobRun bookkeeping and
 * the same hard concurrency guarantee against running twice at once.
 */
export async function POST() {
  try {
    await requireApiPermission("platformTenant", "CONFIGURE");
    const result = await completeDueDeletionRequestsJob();
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return apiErrorResponse(err);
  }
}
