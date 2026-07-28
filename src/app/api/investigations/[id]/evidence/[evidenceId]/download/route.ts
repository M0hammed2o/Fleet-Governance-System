import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { getEvidenceDownloadUrl } from "@/lib/repositories/investigation-evidence-repository";

/** Mints a short-lived signed URL — never streams the file itself, same pattern as billing invoice downloads. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  try {
    const session = await requireApiSession();
    const { evidenceId } = await params;
    const result = await getEvidenceDownloadUrl(session, evidenceId);
    return NextResponse.json(result);
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
