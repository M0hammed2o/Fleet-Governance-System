import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { verifyIdentityForGateEvent, GateEventPreconditionError } from "@/lib/repositories/gate-event-repository";
import { verifyIdentitySchema } from "@/lib/validation/gate-event";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("gateEvent", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = verifyIdentitySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const outcome = await verifyIdentityForGateEvent(session.tenantId, id, session.userId, parsed.data.capturedImageRef);
    if (!outcome) throw new ApiError(404, "Gate event not found");
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof GateEventPreconditionError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
