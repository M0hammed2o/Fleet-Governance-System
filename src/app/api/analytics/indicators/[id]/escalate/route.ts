import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { escalateAnalyticsIndicatorToInvestigation } from "@/lib/repositories/analytics-indicator-repository";
import { indicatorEscalationSchema } from "@/lib/validation/analytics";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const input = indicatorEscalationSchema.parse(await request.json());
    return NextResponse.json(await escalateAnalyticsIndicatorToInvestigation(session, id, input.note, input.existingInvestigationCaseId));
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
