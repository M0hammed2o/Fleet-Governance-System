import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import { hasPermission } from "@/lib/auth/authorize";
import { AssignmentChronologyError, AssignmentConflictError, AssignmentOwnershipError, assignDriverToVehicle, listAssignmentsInTenant } from "@/lib/repositories/driver-vehicle-assignment-repository";
import { createAssignmentSchema } from "@/lib/validation/assignment";

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("driver", "VIEW");
    if (!(await hasPermission(session, "vehicle", "VIEW"))) throw new ApiError(403, "Both driver and vehicle view permission are required.");
    const url = new URL(request.url);
    const assignments = await listAssignmentsInTenant(session.tenantId, {
      driverId: url.searchParams.get("driverId") ?? undefined,
      vehicleId: url.searchParams.get("vehicleId") ?? undefined,
      activeOnly: url.searchParams.get("activeOnly") === "true",
    });
    return NextResponse.json({ assignments });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("driver", "EDIT");
    if (!(await hasPermission(session, "vehicle", "EDIT"))) throw new ApiError(403, "Both driver and vehicle edit permission are required.");
    const parsed = createAssignmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid assignment");
    const assignment = await assignDriverToVehicle({ tenantId: session.tenantId, actorUserId: session.userId, ...parsed.data });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    if (error instanceof AssignmentConflictError || error instanceof AssignmentChronologyError) return apiErrorResponse(new ApiError(409, error.message));
    if (error instanceof AssignmentOwnershipError) return apiErrorResponse(new ApiError(404, error.message));
    return apiErrorResponse(error);
  }
}
