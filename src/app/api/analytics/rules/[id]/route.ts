import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { createAnalyticsRuleVersion } from "@/lib/repositories/analytics-rule-repository";
import { updateAnalyticsRuleSchema } from "@/lib/validation/analytics";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const input = updateAnalyticsRuleSchema.parse(await request.json());
    return NextResponse.json({ rule: await createAnalyticsRuleVersion(session, id, input) });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
