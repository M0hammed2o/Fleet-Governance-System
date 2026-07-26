import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  rejectDeletionRequest,
  DeletionRequestNotFoundError,
  DeletionRequestNotPendingError,
  SelfApprovalNotAllowedError,
} from "@/lib/repositories/retention-repository";
import { rejectDeletionRequestSchema } from "@/lib/validation/retention";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("retention", "APPROVE");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = rejectDeletionRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const deletionRequest = await rejectDeletionRequest(session.tenantId, session.userId, id, parsed.data.reason);
    return NextResponse.json({ deletionRequest });
  } catch (err) {
    if (err instanceof DeletionRequestNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof DeletionRequestNotPendingError) return apiErrorResponse(new ApiError(409, err.message));
    if (err instanceof SelfApprovalNotAllowedError) return apiErrorResponse(new ApiError(403, err.message));
    return apiErrorResponse(err);
  }
}
