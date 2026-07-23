import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listVehiclesInTenant, createVehicle, DuplicateVehicleIdentifierError } from "@/lib/repositories/vehicle-repository";
import { createVehicleSchema } from "@/lib/validation/vehicle";
import { recordAudit } from "@/lib/audit/record-audit";

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("vehicle", "VIEW");
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? undefined;
    const operationalStatus = url.searchParams.get("operationalStatus") as
      | "OPERATIONAL"
      | "WORKSHOP_LOCKOUT"
      | "SECURITY_LOCKOUT"
      | "DECOMMISSIONED"
      | null;
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const pageSizeParam = url.searchParams.get("pageSize");
    const pageSize = pageSizeParam ? Number(pageSizeParam) || undefined : undefined;

    const result = await listVehiclesInTenant(session.tenantId, {
      search,
      operationalStatus: operationalStatus ?? undefined,
      page,
      pageSize,
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("vehicle", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createVehicleSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const { vin, assignedDriverId, tyrePositionConfigId, ...rest } = parsed.data;
    const vehicle = await createVehicle(session.tenantId, {
      ...rest,
      vin: vin || undefined,
      assignedDriverId: assignedDriverId || undefined,
      tyrePositionConfigId: tyrePositionConfigId || undefined,
    });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "vehicle.created",
      entityType: "Vehicle",
      entityId: vehicle.id,
      afterValue: { registrationNumber: vehicle.registrationNumber, vin: vehicle.vin },
    });

    return NextResponse.json({ vehicle });
  } catch (err) {
    if (err instanceof DuplicateVehicleIdentifierError) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    return apiErrorResponse(err);
  }
}
