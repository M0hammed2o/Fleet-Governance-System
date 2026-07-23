import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listInspectionTemplatesInTenant, createInspectionTemplate } from "@/lib/repositories/inspection-template-repository";
import { createInspectionTemplateSchema } from "@/lib/validation/gate-event";

export async function GET() {
  try {
    const session = await requireApiPermission("inspectionTemplate", "VIEW");
    const templates = await listInspectionTemplatesInTenant(session.tenantId);
    return NextResponse.json({ templates });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("inspectionTemplate", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createInspectionTemplateSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const template = await createInspectionTemplate({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      name: parsed.data.name,
      description: parsed.data.description,
      vehicleCategory: parsed.data.vehicleCategory,
      items: parsed.data.items,
    });
    return NextResponse.json({ template });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
