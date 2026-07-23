import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listSitesInTenant, createSite } from "@/lib/repositories/site-repository";
import { createSiteSchema } from "@/lib/validation/organisation";
import { recordAudit } from "@/lib/audit/record-audit";

export async function GET() {
  try {
    const session = await requireApiPermission("site", "VIEW");
    const sites = await listSitesInTenant(session.tenantId);
    return NextResponse.json({ sites });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("site", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createSiteSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const site = await createSite(session.tenantId, { name: parsed.data.name, address: parsed.data.address ?? null });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "site.created",
      entityType: "Site",
      entityId: site.id,
      afterValue: { name: site.name, address: site.address },
    });

    return NextResponse.json({ site });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
