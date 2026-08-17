import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  requireMobilePermission,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { executeMobileMutation } from "@/lib/mobile/idempotency";
import { startGateEventSchema } from "@/lib/validation/gate-event";
import { getGateInTenant } from "@/lib/repositories/gate-repository";
import {
  startGateEvent,
  MovementNotApprovedError,
  DriverNotAvailableError,
  VehicleNotAvailableError,
} from "@/lib/repositories/gate-event-repository";
import { gateDutyApprovalError } from "@/lib/auth/gate-duty";

export async function POST(request: Request) {
  try {
    const session = await requireMobilePermission(
      request,
      "gateEvent",
      "CREATE",
    );
    const parsed = startGateEventSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid input.",
      );
    if (!(await getGateInTenant(session.tenantId, parsed.data.gateId)))
      throw new ApiError(404, "Gate not found.");
    const dutyError = await gateDutyApprovalError(session, parsed.data.gateId);
    if (dutyError) throw new ApiError(403, dutyError);
    const result = await executeMobileMutation({
      session,
      key: request.headers.get("idempotency-key"),
      operation: "gateEvent.start",
      body: parsed.data,
      run: async () => {
        const gateEvent = await startGateEvent({
          tenantId: session.tenantId,
          securityOfficerUserId: session.userId,
          ...parsed.data,
        });
        if (!gateEvent) throw new ApiError(404, "Movement not found.");
        return { gateEvent };
      },
    });
    return NextResponse.json(result.value, {
      status: result.replayed ? 200 : 201,
      headers: { "Idempotency-Replayed": String(result.replayed) },
    });
  } catch (error) {
    if (
      error instanceof MovementNotApprovedError ||
      error instanceof DriverNotAvailableError ||
      error instanceof VehicleNotAvailableError
    )
      return mobileApiErrorResponse(new ApiError(409, error.message));
    return mobileApiErrorResponse(error);
  }
}
