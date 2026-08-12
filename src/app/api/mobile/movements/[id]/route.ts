import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  requireMobilePermission,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { getMovementInTenant } from "@/lib/repositories/movement-repository";
import { trackerSummaries } from "@/lib/mobile/tracker-summary";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireMobilePermission(request, "movement", "VIEW");
    const { id } = await params;
    const movement = await getMovementInTenant(session.tenantId, id);
    if (!movement) throw new ApiError(404, "Movement not found.");
    const trackers = await trackerSummaries(session, [movement.vehicleId]);
    return NextResponse.json(
      {
        movement: {
          id: movement.id,
          referenceCode: movement.referenceCode,
          status: movement.status,
          movementType: movement.movementType,
          purpose: movement.purpose,
          destination: movement.destination,
          expectedDepartureAt: movement.expectedDepartureAt,
          expectedReturnAt: movement.expectedReturnAt,
          approvedCargoSummary: movement.approvedCargoSummary,
          vehicle: {
            id: movement.vehicle.id,
            registrationNumber: movement.vehicle.registrationNumber,
            fleetNumber: movement.vehicle.fleetNumber,
            status: movement.vehicle.operationalStatus,
          },
          driver: {
            id: movement.driver.id,
            name: movement.driver.name,
            employeeNumber: movement.driver.employeeNumber,
            status: movement.driver.status,
          },
          site: { id: movement.site.id, name: movement.site.name },
          approver: movement.approver ? { name: movement.approver.name } : null,
          approvalComments: movement.approvalComments,
        },
        tracker: trackers.get(movement.vehicleId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
