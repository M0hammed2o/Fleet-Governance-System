import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getInspectionTemplateInTenant } from "@/lib/repositories/inspection-template-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("inspectionTemplate", "VIEW");
    const { id } = await params;
    const template = await getInspectionTemplateInTenant(session.tenantId, id);
    if (!template) throw new ApiError(404, "Inspection template not found");
    return NextResponse.json({ template });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
