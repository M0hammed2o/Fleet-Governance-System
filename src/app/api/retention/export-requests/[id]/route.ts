import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getExportRequestInTenant, ExportRequestNotFoundError } from "@/lib/repositories/retention-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("retention", "EXPORT");
    const { id } = await params;
    const exportRequest = await getExportRequestInTenant(session.tenantId, id);
    return NextResponse.json({ exportRequest });
  } catch (err) {
    if (err instanceof ExportRequestNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
