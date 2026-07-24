import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  createVehicleUsePolicy,
  listVehicleUsePoliciesInTenant,
  DriverNotFoundError,
  VehicleNotFoundError,
  GeofenceNotFoundError,
} from "@/lib/repositories/telematics-repository";
import { createVehicleUsePolicySchema } from "@/lib/validation/telematics";

export async function GET() {
  try {
    const session = await requireApiPermission("vehicleUsePolicy", "VIEW");
    const policies = await listVehicleUsePoliciesInTenant(session.tenantId);
    return NextResponse.json({ policies });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("vehicleUsePolicy", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createVehicleUsePolicySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const policy = await createVehicleUsePolicy({ tenantId: session.tenantId, ...parsed.data });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (err) {
    if (err instanceof DriverNotFoundError || err instanceof VehicleNotFoundError || err instanceof GeofenceNotFoundError) {
      return apiErrorResponse(new ApiError(400, err.message));
    }
    return apiErrorResponse(err);
  }
}
