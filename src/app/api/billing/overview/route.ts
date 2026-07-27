import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { getTenantSubscription } from "@/lib/repositories/subscription-repository";
import { getEffectivePricingForTenant, getTenantBillingProfile } from "@/lib/repositories/tenant-billing-repository";
import { countActiveVehiclesForTenant } from "@/lib/repositories/billable-vehicle-repository";

/** P10J — the customer Accountant portal's overview: subscription status, current pricing, active-vehicle billing count, and the tenant's own billing profile, in one call. */
export async function GET() {
  try {
    const session = await requireApiPermission("tenantSubscription", "VIEW");
    const [subscription, pricing, { count: activeVehicleCount }, profile] = await Promise.all([
      getTenantSubscription(session, session.tenantId),
      getEffectivePricingForTenant(session.tenantId),
      countActiveVehiclesForTenant(session.tenantId),
      getTenantBillingProfile(session, session.tenantId).catch(() => null),
    ]);
    return NextResponse.json({ subscription, pricing, activeVehicleCount, profile });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
