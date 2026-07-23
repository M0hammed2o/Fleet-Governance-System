import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { cancelMovement } from "@/lib/repositories/movement-repository";
import { InvalidMovementTransitionError } from "@/lib/movements/state-machine";
import { cancelMovementSchema } from "@/lib/validation/movement";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("movement", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = cancelMovementSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const movement = await cancelMovement(session.tenantId, id, session.userId, parsed.data.reason);
    if (!movement) throw new ApiError(404, "Movement not found");
    return NextResponse.json({ movement });
  } catch (err) {
    if (err instanceof InvalidMovementTransitionError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
