import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import { endTrackerMappingSchema } from "@/lib/validation/telematics";
import { endTrackerMapping, TrackerMappingConflictError, TrackerMappingNotFoundError } from "@/lib/repositories/tracker-mapping-repository";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; mappingId: string }> }) {
  try {
    const session = await requireApiPermission("telematics", "CONFIGURE");
    const { id, mappingId } = await params;
    const parsed = endTrackerMappingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid tracker mapping end request");
    const mapping = await endTrackerMapping({ session, vehicleId: id, mappingId, ...parsed.data });
    return NextResponse.json({ mapping: { ...mapping, providerAssetId: undefined } });
  } catch (error) {
    if (error instanceof TrackerMappingConflictError) return apiErrorResponse(new ApiError(409, error.message));
    if (error instanceof TrackerMappingNotFoundError) return apiErrorResponse(new ApiError(404, error.message));
    return apiErrorResponse(error);
  }
}
