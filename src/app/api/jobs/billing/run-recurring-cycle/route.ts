import { runJobRoute } from "@/lib/jobs/job-route";
import { runRecurringBillingCycleJob } from "@/lib/jobs/jobs";

export async function POST(request: Request) {
  return runJobRoute(request, runRecurringBillingCycleJob);
}
