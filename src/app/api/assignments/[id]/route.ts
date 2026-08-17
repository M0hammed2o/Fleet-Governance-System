import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import { AssignmentChronologyError, AssignmentConflictError, endDriverVehicleAssignment } from "@/lib/repositories/driver-vehicle-assignment-repository";
import { endAssignmentSchema } from "@/lib/validation/assignment";
import { hasPermission } from "@/lib/auth/authorize";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("driver", "EDIT");
    if (!(await hasPermission(session, "vehicle", "EDIT"))) throw new ApiError(403, "Both driver and vehicle edit permission are required.");
    const parsed = endAssignmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid assignment end");
    const { id } = await params;
    const assignment = await endDriverVehicleAssignment({ tenantId: session.tenantId, assignmentId: id, actorUserId: session.userId, ...parsed.data });
    if (!assignment) throw new ApiError(404, "Assignment not found");
    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof AssignmentConflictError || error instanceof AssignmentChronologyError) return apiErrorResponse(new ApiError(409, error.message));
    return apiErrorResponse(error);
  }
}
