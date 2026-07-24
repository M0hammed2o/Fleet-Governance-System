import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { createGeofence, listGeofencesInTenant } from "@/lib/repositories/telematics-repository";
import { createGeofenceSchema } from "@/lib/validation/telematics";

export async function GET() {
  try {
    const session = await requireApiPermission("telematics", "VIEW");
    const geofences = await listGeofencesInTenant(session.tenantId);
    return NextResponse.json({ geofences });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("telematics", "CONFIGURE");
    const body = await request.json().catch(() => null);
    const parsed = createGeofenceSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const geofence = await createGeofence({ tenantId: session.tenantId, ...parsed.data });
    return NextResponse.json({ geofence }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
