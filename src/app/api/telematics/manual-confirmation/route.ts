import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { requestManualGpsConfirmation, VehicleNotFoundError } from "@/lib/repositories/telematics-repository";
import { requestManualGpsConfirmationSchema } from "@/lib/validation/telematics";

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("telematics", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = requestManualGpsConfirmationSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const confirmation = await requestManualGpsConfirmation({
      tenantId: session.tenantId,
      vehicleId: parsed.data.vehicleId,
      requestedByUserId: session.userId,
      reason: parsed.data.reason,
      positionDescription: parsed.data.positionDescription,
    });
    return NextResponse.json({ confirmation });
  } catch (err) {
    if (err instanceof VehicleNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
