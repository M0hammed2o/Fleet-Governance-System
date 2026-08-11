import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { listAnalyticsIndicators } from "@/lib/repositories/analytics-indicator-repository";
import { indicatorListFilterSchema } from "@/lib/validation/analytics";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    const params = new URL(request.url).searchParams;
    const filters = indicatorListFilterSchema.parse(Object.fromEntries(["status", "severity", "subjectType", "subjectId", "ruleCode", "page", "pageSize"].flatMap((key) => params.has(key) ? [[key, params.get(key)]] : [])));
    const result = await listAnalyticsIndicators(session, filters);
    return NextResponse.json(result);
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
