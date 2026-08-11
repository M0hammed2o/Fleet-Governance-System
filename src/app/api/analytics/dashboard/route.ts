import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { getGovernanceAnalyticsDashboard } from "@/lib/repositories/analytics-dashboard-repository";
import { analyticsFiltersFromUrl } from "@/lib/validation/analytics";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    const dashboard = await getGovernanceAnalyticsDashboard(session, analyticsFiltersFromUrl(request.url));
    return NextResponse.json({ dashboard });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
