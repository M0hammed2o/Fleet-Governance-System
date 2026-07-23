import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { upsertVehicleTyre } from "@/lib/repositories/tyre-config-repository";
import { upsertVehicleTyreSchema } from "@/lib/validation/tyre-config";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("vehicle", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = upsertVehicleTyreSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const { positionDefinitionId, ...data } = parsed.data;
    const tyre = await upsertVehicleTyre(session.tenantId, id, positionDefinitionId, data);
    if (!tyre) throw new ApiError(404, "Vehicle or tyre position not found");

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "vehicle.tyre_updated",
      entityType: "Vehicle",
      entityId: id,
      afterValue: { positionDefinitionId, ...data },
    });

    return NextResponse.json({ tyre });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
