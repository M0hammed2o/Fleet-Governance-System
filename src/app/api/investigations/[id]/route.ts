import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { getInvestigationCaseInTenant } from "@/lib/repositories/investigation-case-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const investigationCase = await getInvestigationCaseInTenant(session, id);
    if (!investigationCase) throw new ApiError(404, "Investigation case not found.");
    return NextResponse.json({ investigationCase });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
