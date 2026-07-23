import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { denyGateEvent } from "@/lib/repositories/gate-event-repository";
import { InvalidGateEventTransitionError } from "@/lib/gate-events/state-machine";
import { denyGateEventSchema } from "@/lib/validation/gate-event";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("gateEvent", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = denyGateEventSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const gateEvent = await denyGateEvent({
      tenantId: session.tenantId,
      gateEventId: id,
      actorUserId: session.userId,
      reason: parsed.data.reason,
    });
    if (!gateEvent) throw new ApiError(404, "Gate event not found");
    return NextResponse.json({ gateEvent });
  } catch (err) {
    if (err instanceof InvalidGateEventTransitionError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
