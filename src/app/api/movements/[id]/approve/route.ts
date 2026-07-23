import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { approveMovement, SelfApprovalNotAllowedError } from "@/lib/repositories/movement-repository";
import { InvalidMovementTransitionError } from "@/lib/movements/state-machine";
import { approveMovementSchema } from "@/lib/validation/movement";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("movement", "APPROVE");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = approveMovementSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const movement = await approveMovement({
      tenantId: session.tenantId,
      movementId: id,
      approverUserId: session.userId,
      comments: parsed.data.comments,
    });
    if (!movement) throw new ApiError(404, "Movement not found");
    return NextResponse.json({ movement });
  } catch (err) {
    if (err instanceof SelfApprovalNotAllowedError) return apiErrorResponse(new ApiError(403, err.message));
    if (err instanceof InvalidMovementTransitionError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
