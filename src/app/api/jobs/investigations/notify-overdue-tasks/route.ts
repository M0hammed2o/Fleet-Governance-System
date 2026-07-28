import { runJobRoute } from "@/lib/jobs/job-route";
import { notifyOverdueInvestigationTasksJob } from "@/lib/jobs/jobs";

export async function POST(request: Request) {
  return runJobRoute(request, notifyOverdueInvestigationTasksJob);
}
