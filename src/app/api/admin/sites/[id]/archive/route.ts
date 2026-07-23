import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getSiteInTenant, archiveSite } from "@/lib/repositories/site-repository";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("site", "DELETE");
    const { id } = await params;

    const site = await getSiteInTenant(session.tenantId, id);
    if (!site) throw new ApiError(404, "Site not found");

    await archiveSite(session.tenantId, id);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "site.archived",
      entityType: "Site",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
