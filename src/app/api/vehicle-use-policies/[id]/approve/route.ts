import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  approveVehicleUsePolicy,
  NotTheApprovingManagerError,
  PolicyNotDraftError,
} from "@/lib/repositories/telematics-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("vehicleUsePolicy", "APPROVE");
    const { id } = await params;

    const policy = await approveVehicleUsePolicy(session.tenantId, id, session.userId);
    if (!policy) throw new ApiError(404, "Vehicle-use policy not found");
    return NextResponse.json({ policy });
  } catch (err) {
    if (err instanceof NotTheApprovingManagerError) return apiErrorResponse(new ApiError(403, err.message));
    if (err instanceof PolicyNotDraftError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
