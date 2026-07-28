import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { amendInvestigationNote } from "@/lib/repositories/investigation-case-repository";
import { amendNoteSchema } from "@/lib/validation/investigations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const session = await requireApiSession();
    const { noteId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = amendNoteSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const note = await amendInvestigationNote(session, noteId, parsed.data.content);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
