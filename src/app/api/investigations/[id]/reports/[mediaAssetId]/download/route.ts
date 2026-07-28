import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { getInvestigationReportDownloadUrl } from "@/lib/repositories/investigation-report-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; mediaAssetId: string }> }) {
  try {
    const session = await requireApiSession();
    const { id, mediaAssetId } = await params;
    const result = await getInvestigationReportDownloadUrl(session, id, mediaAssetId);
    return NextResponse.json(result);
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
