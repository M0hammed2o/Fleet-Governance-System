import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDriverInTenant } from "@/lib/repositories/driver-repository";
import { requestManualFallback } from "@/lib/repositories/facial-verification-repository";
import { requestManualFallbackSchema } from "@/lib/validation/driver";
import { getGateEventInTenant } from "@/lib/repositories/gate-event-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("facialVerificationFallback", "CREATE");
    const { id } = await params;
    const driver = await getDriverInTenant(session.tenantId, id);
    if (!driver) throw new ApiError(404, "Driver not found");

    const body = await request.json().catch(() => null);
    const parsed = requestManualFallbackSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    if (parsed.data.relatedGateEventId) {
      const event = await getGateEventInTenant(
        session.tenantId,
        parsed.data.relatedGateEventId,
      );
      if (!event || event.driverId !== id)
        throw new ApiError(404, "Gate event not found for this driver");
      if (event.status !== "IDENTITY_PENDING")
        throw new ApiError(409, "Gate event identity is not pending");
    }

    const fallback = await requestManualFallback({
      tenantId: session.tenantId,
      driverId: id,
      requestedByUserId: session.userId,
      reason: parsed.data.reason,
      relatedGateEventId: parsed.data.relatedGateEventId,
    });

    return NextResponse.json({ fallback });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
