import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  approveDeletionRequest,
  DeletionRequestNotFoundError,
  DeletionRequestNotPendingError,
  SelfApprovalNotAllowedError,
  EmptyDeletionScopeError,
} from "@/lib/repositories/retention-repository";

/** The second, deliberately different, authorised user approves a deletion request (dual-control). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("retention", "APPROVE");
    const { id } = await params;
    const deletionRequest = await approveDeletionRequest(session.tenantId, session.userId, id);
    return NextResponse.json({ deletionRequest });
  } catch (err) {
    if (err instanceof DeletionRequestNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof DeletionRequestNotPendingError) return apiErrorResponse(new ApiError(409, err.message));
    if (err instanceof SelfApprovalNotAllowedError) return apiErrorResponse(new ApiError(403, err.message));
    if (err instanceof EmptyDeletionScopeError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
