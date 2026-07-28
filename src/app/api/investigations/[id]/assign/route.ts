import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { assignInvestigator } from "@/lib/repositories/investigation-case-repository";
import { assignInvestigatorSchema } from "@/lib/validation/investigations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = assignInvestigatorSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const investigationCase = await assignInvestigator(session, id, parsed.data.investigatorUserId);
    return NextResponse.json({ investigationCase });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
