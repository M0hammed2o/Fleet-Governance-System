import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { getAnalyticsIndicator } from "@/lib/repositories/analytics-indicator-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    return NextResponse.json({ indicator: await getAnalyticsIndicator(session, id) });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
