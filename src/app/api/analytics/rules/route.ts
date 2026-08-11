import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { listCurrentAnalyticsRules } from "@/lib/repositories/analytics-rule-repository";

export async function GET() {
  try {
    const session = await requireApiSession();
    return NextResponse.json({ rules: await listCurrentAnalyticsRules(session) });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
