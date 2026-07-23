import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  listGateEventsInTenant,
  startGateEvent,
  MovementNotApprovedError,
  DriverNotAvailableError,
  VehicleNotAvailableError,
} from "@/lib/repositories/gate-event-repository";
import { startGateEventSchema } from "@/lib/validation/gate-event";
import { getGateInTenant } from "@/lib/repositories/gate-repository";
import type { GateEventStatus } from "@/lib/gate-events/state-machine";

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("gateEvent", "VIEW");
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as GateEventStatus | null;
    const page = Number(url.searchParams.get("page") ?? "1") || 1;

    const result = await listGateEventsInTenant(session.tenantId, { status: status ?? undefined, page });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("gateEvent", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = startGateEventSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const gate = await getGateInTenant(session.tenantId, parsed.data.gateId);
    if (!gate) throw new ApiError(400, "That gate does not belong to your company.");

    const gateEvent = await startGateEvent({
      tenantId: session.tenantId,
      movementAuthorisationId: parsed.data.movementAuthorisationId,
      gateId: parsed.data.gateId,
      direction: parsed.data.direction,
      securityOfficerUserId: session.userId,
    });
    if (!gateEvent) throw new ApiError(404, "Movement not found");

    return NextResponse.json({ gateEvent });
  } catch (err) {
    if (err instanceof MovementNotApprovedError || err instanceof DriverNotAvailableError || err instanceof VehicleNotAvailableError) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    return apiErrorResponse(err);
  }
}
