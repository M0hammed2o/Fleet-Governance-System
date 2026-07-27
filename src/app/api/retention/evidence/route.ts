import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { listEvidenceInTenant } from "@/lib/repositories/retention-repository";
import { mediaCategorySchema } from "@/lib/validation/media";

/** Browsing surface for the retention management UI (8E-005) — metadata only, see listEvidenceInTenant()'s own comment. */
export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("retention", "VIEW");
    const url = new URL(request.url);
    const categoryParam = url.searchParams.get("category");
    const parsedCategory = categoryParam ? mediaCategorySchema.safeParse(categoryParam) : null;
    const evidence = await listEvidenceInTenant(session.tenantId, {
      category: parsedCategory?.success ? parsedCategory.data : undefined,
      onlyHeld: url.searchParams.get("onlyHeld") === "true",
      onlyApproachingExpiry: url.searchParams.get("onlyApproachingExpiry") === "true",
    });
    return NextResponse.json({ evidence });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
