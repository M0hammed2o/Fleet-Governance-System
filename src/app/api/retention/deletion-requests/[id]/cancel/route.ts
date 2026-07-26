import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  cancelDeletionRequest,
  DeletionRequestNotFoundError,
  DeletionRequestNotPendingError,
  NotRequestInitiatorError,
} from "@/lib/repositories/retention-repository";

/** The requester withdraws their own still-pending deletion request. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("retention", "CREATE");
    const { id } = await params;
    const deletionRequest = await cancelDeletionRequest(session.tenantId, session.userId, id);
    return NextResponse.json({ deletionRequest });
  } catch (err) {
    if (err instanceof DeletionRequestNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof DeletionRequestNotPendingError) return apiErrorResponse(new ApiError(409, err.message));
    if (err instanceof NotRequestInitiatorError) return apiErrorResponse(new ApiError(403, err.message));
    return apiErrorResponse(err);
  }
}
