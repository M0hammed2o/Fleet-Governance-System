import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { getInvestigationDashboardCounts } from "@/lib/repositories/investigation-case-repository";

export async function GET() {
  try {
    const session = await requireApiSession();
    const counts = await getInvestigationDashboardCounts(session);
    return NextResponse.json(counts);
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
