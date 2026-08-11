import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { getGovernanceAnalyticsReportDownload } from "@/lib/repositories/analytics-export-repository";

export async function GET(request: Request, { params }: { params: Promise<{ mediaAssetId: string }> }) {
  try {
    const session = await requireApiSession();
    const { mediaAssetId } = await params;
    return NextResponse.json(await getGovernanceAnalyticsReportDownload(session, mediaAssetId));
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}

