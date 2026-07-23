import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { rejectMovement } from "@/lib/repositories/movement-repository";
import { InvalidMovementTransitionError } from "@/lib/movements/state-machine";
import { rejectMovementSchema } from "@/lib/validation/movement";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("movement", "REJECT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = rejectMovementSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const movement = await rejectMovement({
      tenantId: session.tenantId,
      movementId: id,
      approverUserId: session.userId,
      comments: parsed.data.comments,
    });
    if (!movement) throw new ApiError(404, "Movement not found");
    return NextResponse.json({ movement });
  } catch (err) {
    if (err instanceof InvalidMovementTransitionError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
