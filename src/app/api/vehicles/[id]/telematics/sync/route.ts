import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { syncVehicleTelematics, VehicleNotFoundError } from "@/lib/repositories/telematics-repository";
import { TelematicsProviderUnavailableError } from "@/lib/telematics/provider";

/**
 * Manually (re)triggers a telematics sync for one vehicle from the (mock)
 * provider (GPS-001/GPS-003). A provider failure is a typed 503, not a raw
 * 500 (GPS-006).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("telematics", "CREATE");
    const { id } = await params;

    const result = await syncVehicleTelematics({ tenantId: session.tenantId, vehicleId: id, actorUserId: session.userId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof VehicleNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof TelematicsProviderUnavailableError) return apiErrorResponse(new ApiError(503, err.message));
    return apiErrorResponse(err);
  }
}
