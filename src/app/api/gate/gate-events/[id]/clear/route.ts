import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { clearGateEvent, VehicleNotAvailableError } from "@/lib/repositories/gate-event-repository";
import { InvalidGateEventTransitionError } from "@/lib/gate-events/state-machine";
import { gateEventDecisionSchema } from "@/lib/validation/gate-event";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("gateEvent", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = gateEventDecisionSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const gateEvent = await clearGateEvent({
      tenantId: session.tenantId,
      gateEventId: id,
      actorUserId: session.userId,
      reason: parsed.data.reason,
    });
    if (!gateEvent) throw new ApiError(404, "Gate event not found");
    return NextResponse.json({ gateEvent });
  } catch (err) {
    if (err instanceof InvalidGateEventTransitionError || err instanceof VehicleNotAvailableError) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    return apiErrorResponse(err);
  }
}
