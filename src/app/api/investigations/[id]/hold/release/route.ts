import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { releaseInvestigationHold } from "@/lib/repositories/investigation-hold-repository";
import { releaseHoldSchema } from "@/lib/validation/investigations";

/** May return { released: false, requiresSecondApprover: true } for a HIGH/CRITICAL case's first release request (P11G dual approval) — the caller must show this, not treat it as a hard failure. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = releaseHoldSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const result = await releaseInvestigationHold(session, id, parsed.data.reason);
    return NextResponse.json(result);
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
