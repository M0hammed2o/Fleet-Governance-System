import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { linkRelatedRecord, listRelatedRecords } from "@/lib/repositories/investigation-case-repository";
import { linkRelatedRecordSchema } from "@/lib/validation/investigations";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const relatedRecords = await listRelatedRecords(session, id);
    return NextResponse.json({ relatedRecords });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = linkRelatedRecordSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const relatedRecord = await linkRelatedRecord(session, id, parsed.data);
    return NextResponse.json({ relatedRecord }, { status: 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
