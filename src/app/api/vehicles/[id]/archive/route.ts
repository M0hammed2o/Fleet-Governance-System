import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getVehicleInTenant, archiveVehicle } from "@/lib/repositories/vehicle-repository";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("vehicle", "DELETE");
    const { id } = await params;
    const vehicle = await getVehicleInTenant(session.tenantId, id);
    if (!vehicle) throw new ApiError(404, "Vehicle not found");

    await archiveVehicle(session.tenantId, id);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "vehicle.archived",
      entityType: "Vehicle",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
