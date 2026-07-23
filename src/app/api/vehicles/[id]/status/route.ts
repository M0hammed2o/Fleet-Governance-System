import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getVehicleInTenant, setVehicleOperationalStatus } from "@/lib/repositories/vehicle-repository";
import { vehicleOperationalStatusUpdateSchema } from "@/lib/validation/vehicle";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("vehicle", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = vehicleOperationalStatusUpdateSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const before = await getVehicleInTenant(session.tenantId, id);
    if (!before) throw new ApiError(404, "Vehicle not found");

    await setVehicleOperationalStatus(session.tenantId, id, parsed.data.operationalStatus);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "vehicle.operational_status_changed",
      entityType: "Vehicle",
      entityId: id,
      beforeValue: { operationalStatus: before.operationalStatus },
      afterValue: { operationalStatus: parsed.data.operationalStatus },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
