import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { rejectInvestigationFinding } from "@/lib/repositories/investigation-finding-repository";
import { reasonRequiredSchema } from "@/lib/validation/investigations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; findingId: string }> }) {
  try {
    const session = await requireApiSession();
    const { id, findingId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = reasonRequiredSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const finding = await rejectInvestigationFinding(session, id, findingId, parsed.data.reason);
    return NextResponse.json({ finding });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
