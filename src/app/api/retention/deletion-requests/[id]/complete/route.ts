import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  completeDeletionRequest,
  DeletionRequestNotFoundError,
  DeletionRequestNotApprovedError,
  RecoveryPeriodNotElapsedError,
} from "@/lib/repositories/retention-repository";

/**
 * Manually triggers permanent deletion for one APPROVED request whose
 * recovery period has elapsed — not yet wired to any scheduler (see
 * `POST /api/admin/retention/process-due-deletions` for the batch
 * equivalent; no scheduling infrastructure exists in this codebase yet,
 * same documented gap as the existing `expireMovement` auto-transition).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("retention", "APPROVE");
    const { id } = await params;
    const certificate = await completeDeletionRequest(session.tenantId, id);
    return NextResponse.json({ certificate });
  } catch (err) {
    if (err instanceof DeletionRequestNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof DeletionRequestNotApprovedError) return apiErrorResponse(new ApiError(409, err.message));
    if (err instanceof RecoveryPeriodNotElapsedError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
