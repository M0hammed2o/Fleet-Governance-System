import "server-only";
import crypto from "node:crypto";
import { requireApiPermission } from "@/lib/auth/api-guard";

/**
 * Production scheduler boundary (8E-004): a shared-secret bearer credential
 * a cron/scheduler process presents via the `x-job-scheduler-token` header
 * — entirely separate from ordinary user-session authentication, so a
 * scheduled process doesn't need an interactive login. No scheduler
 * infrastructure (a managed cron trigger, a queue worker, etc.) is wired up
 * in this codebase yet — see TODO.md — this is the auth boundary such
 * infrastructure calls through once chosen.
 *
 * `JOB_SCHEDULER_TOKEN` must be set via environment/secret manager in
 * production. If it is not set, every job endpoint fails closed (refuses
 * every request, including ones bearing a token) rather than silently
 * accepting unauthenticated calls — same "fail closed on missing
 * configuration" discipline as the rest of this codebase's security
 * boundaries.
 */
export class ServiceAuthNotConfiguredError extends Error {
  constructor() {
    super("JOB_SCHEDULER_TOKEN is not configured — this job endpoint is fail-closed until it is set.");
    this.name = "ServiceAuthNotConfiguredError";
  }
}

export class InvalidServiceTokenError extends Error {
  constructor() {
    super("Invalid or missing service job token.");
    this.name = "InvalidServiceTokenError";
  }
}

const SERVICE_TOKEN_HEADER = "x-job-scheduler-token";

function securelyMatches(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Authorizes one job-endpoint request. Two independent paths, either is
 * sufficient:
 *   1. A valid `x-job-scheduler-token` header — the scheduler/service path.
 *   2. An authenticated session holding `platformTenant:CONFIGURE` — lets a
 *      Platform Administrator trigger a job on demand from the existing
 *      admin session, same permission tier as every other cross-tenant
 *      batch action (see process-due-deletions/route.ts).
 * A normal customer-tenant administrator has neither, by design (8E-004
 * "do not rely on a normal customer administrator manually calling a
 * sensitive processing endpoint").
 */
export async function authorizeJobRequest(request: Request): Promise<void> {
  const provided = request.headers.get(SERVICE_TOKEN_HEADER);
  if (provided !== null) {
    const configured = [process.env.JOB_SCHEDULER_TOKEN, process.env.JOB_SCHEDULER_TOKEN_PREVIOUS].filter(
      (value): value is string => Boolean(value),
    );
    if (configured.length === 0) throw new ServiceAuthNotConfiguredError();
    if (!configured.some((candidate) => securelyMatches(provided, candidate))) {
      throw new InvalidServiceTokenError();
    }
    return;
  }
  await requireApiPermission("platformTenant", "CONFIGURE");
}
