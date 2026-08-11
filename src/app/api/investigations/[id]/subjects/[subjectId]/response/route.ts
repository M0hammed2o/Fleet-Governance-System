import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { recordSubjectResponse } from "@/lib/repositories/investigation-case-repository";
import { subjectResponseSchema } from "@/lib/validation/investigations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; subjectId: string }> }) {
  try {
    const session = await requireApiSession();
    const { id, subjectId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = subjectResponseSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const subject = await recordSubjectResponse(session, id, subjectId, parsed.data.explanationResponse);
    return NextResponse.json({ subject });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
