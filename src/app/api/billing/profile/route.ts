import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getTenantBillingProfile, upsertTenantBillingProfile } from "@/lib/repositories/tenant-billing-repository";
import { upsertTenantBillingProfileSchema } from "@/lib/validation/billing";

/** P10C — the caller's own tenant billing profile. */
export async function GET() {
  try {
    const session = await requireApiPermission("tenantBilling", "VIEW");
    const profile = await getTenantBillingProfile(session, session.tenantId);
    return NextResponse.json({ profile });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApiPermission("tenantBilling", "EDIT");
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = upsertTenantBillingProfileSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const profile = await upsertTenantBillingProfile(session, session.tenantId, parsed.data);
    return NextResponse.json({ profile });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
