import "server-only";
import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/auth/api-guard";
import { authorizeJobRequest, InvalidServiceTokenError, ServiceAuthNotConfiguredError } from "@/lib/jobs/service-auth";
import { JobAlreadyRunningError } from "@/lib/jobs/run-job";

/**
 * Shared handler body for every `src/app/api/jobs/*` route (8E-004) — each
 * route file itself is just `authorizeJobRequest` + one job function, kept
 * this thin so the auth/error-mapping logic exists exactly once.
 */
export async function runJobRoute(request: Request, jobFn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    await authorizeJobRequest(request);
    const result = await jobFn();
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof ServiceAuthNotConfiguredError || err instanceof InvalidServiceTokenError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return apiErrorResponse(err);
  }
}
