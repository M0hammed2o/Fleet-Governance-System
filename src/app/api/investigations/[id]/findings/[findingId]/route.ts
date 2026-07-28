import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { updateDraftFinding } from "@/lib/repositories/investigation-finding-repository";
import { findingFieldsSchema } from "@/lib/validation/investigations";

/** Updates a DRAFT finding in place — only valid before it is submitted for approval. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; findingId: string }> }) {
  try {
    const session = await requireApiSession();
    const { findingId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = findingFieldsSchema.partial().safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const finding = await updateDraftFinding(session, findingId, parsed.data);
    return NextResponse.json({ finding });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
