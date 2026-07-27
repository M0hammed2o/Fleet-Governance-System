import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { setCustomerBillingContactActive, BillingContactNotFoundError } from "@/lib/repositories/tenant-billing-repository";
import { setCustomerBillingContactActiveSchema } from "@/lib/validation/billing";

/** P10C/J — activate/deactivate one of the caller's own tenant's billing contacts. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("tenantBilling", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = setCustomerBillingContactActiveSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const contact = await setCustomerBillingContactActive(session, session.tenantId, id, parsed.data.isActive);
    return NextResponse.json({ contact });
  } catch (err) {
    if (err instanceof BillingContactNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
