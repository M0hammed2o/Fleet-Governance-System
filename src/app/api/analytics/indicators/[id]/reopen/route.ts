import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { reopenAnalyticsIndicator } from "@/lib/repositories/analytics-indicator-repository";
import { indicatorReviewSchema } from "@/lib/validation/analytics";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const { note } = indicatorReviewSchema.parse(await request.json());
    return NextResponse.json({ indicator: await reopenAnalyticsIndicator(session, id, note) });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
