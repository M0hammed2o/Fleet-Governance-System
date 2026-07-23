import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { completeGateEvent } from "@/lib/repositories/gate-event-repository";
import { InvalidGateEventTransitionError } from "@/lib/gate-events/state-machine";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("gateEvent", "EDIT");
    const { id } = await params;
    const gateEvent = await completeGateEvent(session.tenantId, id, session.userId);
    if (!gateEvent) throw new ApiError(404, "Gate event not found");
    return NextResponse.json({ gateEvent });
  } catch (err) {
    if (err instanceof InvalidGateEventTransitionError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
