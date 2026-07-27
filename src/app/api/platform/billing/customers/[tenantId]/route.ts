import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { getTenantBillingProfile } from "@/lib/repositories/tenant-billing-repository";
import { getTenantSubscription } from "@/lib/repositories/subscription-repository";
import { listInvoicesForTenant } from "@/lib/repositories/invoice-repository";
import { listPaymentsForTenant } from "@/lib/repositories/payment-repository";

/** P10I — one customer tenant's full billing detail bundle, for the platform-admin dashboard's drill-down view. */
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const session = await requireApiPermission("platformBilling", "VIEW");
    const { tenantId } = await params;

    const [profile, subscription, invoices, payments] = await Promise.all([
      getTenantBillingProfile(session, tenantId),
      getTenantSubscription(session, tenantId),
      listInvoicesForTenant(session, tenantId),
      listPaymentsForTenant(session, tenantId),
    ]);

    return NextResponse.json({ profile, subscription, invoices, payments });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
