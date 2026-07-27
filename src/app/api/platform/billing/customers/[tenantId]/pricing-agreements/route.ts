import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { createTenantPricingAgreement, listTenantPricingAgreements, InvalidPricingAmountError } from "@/lib/repositories/tenant-billing-repository";
import { createTenantPricingAgreementSchema } from "@/lib/validation/billing";

/** P10B/I — a tenant's negotiated pricing history; platform-admin only. */
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const session = await requireApiPermission("pricingAgreement", "VIEW");
    const { tenantId } = await params;
    const agreements = await listTenantPricingAgreements(session, tenantId);
    return NextResponse.json({ agreements });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const session = await requireApiPermission("pricingAgreement", "EDIT");
    const { tenantId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = createTenantPricingAgreementSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const agreement = await createTenantPricingAgreement(session, tenantId, parsed.data);
    return NextResponse.json({ agreement });
  } catch (err) {
    if (err instanceof InvalidPricingAmountError) return apiErrorResponse(new ApiError(400, err.message));
    return apiErrorResponse(err);
  }
}
