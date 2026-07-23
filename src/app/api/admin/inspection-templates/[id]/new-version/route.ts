import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { createNewTemplateVersion } from "@/lib/repositories/inspection-template-repository";
import { createInspectionTemplateSchema } from "@/lib/validation/gate-event";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("inspectionTemplate", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = createInspectionTemplateSchema.pick({ description: true, items: true }).safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const template = await createNewTemplateVersion(session.tenantId, id, {
      actorUserId: session.userId,
      description: parsed.data.description,
      items: parsed.data.items,
    });
    if (!template) throw new ApiError(404, "Inspection template not found");
    return NextResponse.json({ template });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
