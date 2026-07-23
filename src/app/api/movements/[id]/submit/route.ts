import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { submitMovement } from "@/lib/repositories/movement-repository";
import { InvalidMovementTransitionError } from "@/lib/movements/state-machine";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("movement", "EDIT");
    const { id } = await params;
    const movement = await submitMovement(session.tenantId, id, session.userId);
    if (!movement) throw new ApiError(404, "Movement not found");
    return NextResponse.json({ movement });
  } catch (err) {
    if (err instanceof InvalidMovementTransitionError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
