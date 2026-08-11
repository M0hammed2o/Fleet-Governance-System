import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { generateGovernanceAnalyticsReport } from "@/lib/repositories/analytics-export-repository";
import { analyticsFilterSchema } from "@/lib/validation/analytics";

export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const filters = analyticsFilterSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ report: await generateGovernanceAnalyticsReport(session, filters) }, { status: 201 });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
