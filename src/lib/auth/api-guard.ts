import "server-only";
import { NextResponse } from "next/server";
import { getSession, type AuthenticatedSession } from "@/lib/auth/session";
import { hasPermission, ForbiddenError } from "@/lib/auth/authorize";
import type { PermissionResource, PermissionAction } from "@/lib/auth/permissions";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Route-handler entry point: 401s if unauthenticated, 403s if the permission is missing. */
export async function requireApiPermission(
  resource: PermissionResource,
  action: PermissionAction,
): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Not authenticated");
  const allowed = await hasPermission(session, resource, action);
  if (!allowed) throw new ApiError(403, "Forbidden");
  return session;
}

/** Same as requireApiPermission but only checks authentication, no permission. */
export async function requireApiSession(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Not authenticated");
  return session;
}

/**
 * Converts a thrown ApiError, or a ForbiddenError raised deep inside a
 * repository function's own requirePermission() call (e.g.
 * platform-tenant-repository.ts), into a JSON response. Catch-all for route
 * handlers — every route's try/catch should end with `return apiErrorResponse(err)`.
 */
export function apiErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
