import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { linkEvidenceFromMediaAsset, listEvidenceForCase } from "@/lib/repositories/investigation-evidence-repository";
import { linkEvidenceSchema } from "@/lib/validation/investigations";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const evidence = await listEvidenceForCase(session, id);
    return NextResponse.json({ evidence });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}

/** Links an already-existing MediaAsset (e.g. a gate-inspection photo) as case evidence. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = linkEvidenceSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const evidence = await linkEvidenceFromMediaAsset(session, id, parsed.data);
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
