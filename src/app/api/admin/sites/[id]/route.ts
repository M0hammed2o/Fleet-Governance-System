import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getSiteInTenant, updateSite } from "@/lib/repositories/site-repository";
import { updateSiteSchema } from "@/lib/validation/organisation";
import { recordAudit } from "@/lib/audit/record-audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("site", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateSiteSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const before = await getSiteInTenant(session.tenantId, id);
    if (!before) throw new ApiError(404, "Site not found");

    const updated = await updateSite(session.tenantId, id, parsed.data);
    if (!updated) throw new ApiError(404, "Site not found");

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "site.updated",
      entityType: "Site",
      entityId: id,
      beforeValue: { name: before.name, address: before.address },
      afterValue: parsed.data,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
