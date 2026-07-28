import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { getCaseForAuditor } from "@/lib/repositories/external-auditor-access-repository";

/** Re-verifies a live grant on every call and logs the view (P11L) — read-only, no edit route exists in this namespace. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const investigationCase = await getCaseForAuditor(session, id);
    return NextResponse.json({ investigationCase });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
