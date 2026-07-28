import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { getEvidenceForAuditor } from "@/lib/repositories/external-auditor-access-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  try {
    const session = await requireApiSession();
    const { id, evidenceId } = await params;
    const result = await getEvidenceForAuditor(session, id, evidenceId);
    return NextResponse.json(result);
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
