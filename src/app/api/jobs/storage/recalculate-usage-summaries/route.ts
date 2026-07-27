import { runJobRoute } from "@/lib/jobs/job-route";
import { recalculateStorageUsageSummariesJob } from "@/lib/jobs/jobs";

export async function POST(request: Request) {
  return runJobRoute(request, recalculateStorageUsageSummariesJob);
}
