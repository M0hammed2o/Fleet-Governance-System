import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import { createTrackerMappingSchema } from "@/lib/validation/telematics";
import { createTrackerMapping, listTrackerMappingHistory, SyntheticMappingProductionError, TrackerMappingConflictError, TrackerMappingNotFoundError } from "@/lib/repositories/tracker-mapping-repository";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("telematics", "VIEW");
    const { id } = await params;
    return NextResponse.json({ mappings: await listTrackerMappingHistory(session, id) });
  } catch (error) {
    if (error instanceof TrackerMappingNotFoundError) return apiErrorResponse(new ApiError(404, error.message));
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("telematics", "CONFIGURE");
    const { id } = await params;
    const parsed = createTrackerMappingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid tracker mapping");
    const mapping = await createTrackerMapping({ session, vehicleId: id, ...parsed.data });
    return NextResponse.json({ mapping: { ...mapping, providerAssetId: undefined } }, { status: 201 });
  } catch (error) {
    if (error instanceof TrackerMappingConflictError) return apiErrorResponse(new ApiError(409, error.message));
    if (error instanceof TrackerMappingNotFoundError) return apiErrorResponse(new ApiError(404, error.message));
    if (error instanceof SyntheticMappingProductionError) return apiErrorResponse(new ApiError(403, error.message));
    return apiErrorResponse(error);
  }
}
