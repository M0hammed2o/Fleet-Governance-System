import "server-only";
import { NextResponse } from "next/server";
import {
  getSessionFromRequest,
  type AuthenticatedSession,
} from "@/lib/auth/session";
import { hasPermission, ForbiddenError } from "@/lib/auth/authorize";
import type {
  PermissionAction,
  PermissionResource,
} from "@/lib/auth/permissions";
import { ApiError } from "@/lib/auth/api-guard";
import { logger } from "@/lib/observability/logger";

export async function requireMobileSession(
  request: Request,
): Promise<AuthenticatedSession> {
  const session = await getSessionFromRequest(request);
  if (!session)
    throw new ApiError(401, "Session expired or revoked. Sign in again.");
  return session;
}

export async function requireMobilePermission(
  request: Request,
  resource: PermissionResource,
  action: PermissionAction,
) {
  const session = await requireMobileSession(request);
  if (!(await hasPermission(session, resource, action)))
    throw new ApiError(403, "This action is not permitted.");
  return session;
}

export function mobileApiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError)
    return NextResponse.json(
      {
        error: error.message,
        code:
          error.status === 401
            ? "SESSION_INVALID"
            : error.status === 403
              ? "FORBIDDEN"
              : error.status === 429
                ? "RATE_LIMITED"
              : "INVALID_REQUEST",
        retryable: error.status === 429 || error.status >= 500,
      },
      {
        status: error.status,
        headers:
          error.status === 429 ? { "Retry-After": "300" } : undefined,
      },
    );
  if (error instanceof ForbiddenError)
    return NextResponse.json(
      { error: "This action is not permitted.", code: "FORBIDDEN" },
      { status: 403 },
    );
  logger.error("mobile.api_unhandled_error", { error });
  return NextResponse.json(
    {
      error: "The request could not be completed.",
      code: "INTERNAL_ERROR",
      retryable: true,
    },
    { status: 500 },
  );
}
