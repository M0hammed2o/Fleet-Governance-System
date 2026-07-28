import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { markEvidenceEnteredInError } from "@/lib/repositories/investigation-evidence-repository";
import { enteredInErrorSchema } from "@/lib/validation/investigations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  try {
    const session = await requireApiSession();
    const { evidenceId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = enteredInErrorSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const evidence = await markEvidenceEnteredInError(session, evidenceId, parsed.data.reason);
    return NextResponse.json({ evidence });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
