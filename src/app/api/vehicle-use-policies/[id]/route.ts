import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getVehicleUsePolicyInTenant } from "@/lib/repositories/telematics-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("vehicleUsePolicy", "VIEW");
    const { id } = await params;
    const policy = await getVehicleUsePolicyInTenant(session.tenantId, id);
    if (!policy) throw new ApiError(404, "Vehicle-use policy not found");
    return NextResponse.json({ policy });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
