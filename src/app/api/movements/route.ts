import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  listMovementsInTenant,
  createMovement,
  DriverNotAvailableError,
  VehicleNotAvailableError,
  TenantAccessSuspendedError,
} from "@/lib/repositories/movement-repository";
import { getVehicleInTenant } from "@/lib/repositories/vehicle-repository";
import { getDriverInTenant } from "@/lib/repositories/driver-repository";
import { getSiteInTenant } from "@/lib/repositories/site-repository";
import { createMovementSchema } from "@/lib/validation/movement";
import { recordAudit } from "@/lib/audit/record-audit";
import type { MovementStatus } from "@/lib/movements/state-machine";

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("movement", "VIEW");
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as MovementStatus | null;
    const page = Number(url.searchParams.get("page") ?? "1") || 1;

    const result = await listMovementsInTenant(session.tenantId, { status: status ?? undefined, page });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("movement", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createMovementSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const [site, vehicle, driver] = await Promise.all([
      getSiteInTenant(session.tenantId, parsed.data.siteId),
      getVehicleInTenant(session.tenantId, parsed.data.vehicleId),
      getDriverInTenant(session.tenantId, parsed.data.driverId),
    ]);
    if (!site) throw new ApiError(400, "That site does not belong to your company.");
    if (!vehicle) throw new ApiError(400, "That vehicle does not belong to your company.");
    if (!driver) throw new ApiError(400, "That driver does not belong to your company.");
    if (parsed.data.trailerVehicleId) {
      const trailer = await getVehicleInTenant(session.tenantId, parsed.data.trailerVehicleId);
      if (!trailer) throw new ApiError(400, "That trailer does not belong to your company.");
    }

    const { trailerVehicleId, ...rest } = parsed.data;
    const movement = await createMovement({
      tenantId: session.tenantId,
      ...rest,
      trailerVehicleId: trailerVehicleId || undefined,
      requesterUserId: session.userId,
    });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "movement.created",
      entityType: "MovementAuthorisation",
      entityId: movement.id,
      afterValue: { movementType: movement.movementType, referenceCode: movement.referenceCode },
    });

    return NextResponse.json({ movement });
  } catch (err) {
    if (err instanceof DriverNotAvailableError || err instanceof VehicleNotAvailableError) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    if (err instanceof TenantAccessSuspendedError) {
      return apiErrorResponse(new ApiError(403, err.message));
    }
    return apiErrorResponse(err);
  }
}
