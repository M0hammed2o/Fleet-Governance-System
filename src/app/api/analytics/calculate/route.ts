import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { calculateAnalyticsForTenant } from "@/lib/repositories/analytics-calculation-repository";

/** Manual local/authorised refresh. Scheduled runs use the service-auth job route. */
export async function POST() {
  try {
    const session = await requireApiPermission("analyticsIndicator", "CREATE");
    const result = await calculateAnalyticsForTenant(session.tenantId);
    return NextResponse.json({ result });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
