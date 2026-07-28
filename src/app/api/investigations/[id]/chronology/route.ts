import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { listChronology } from "@/lib/repositories/investigation-case-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const chronology = await listChronology(session, id);
    return NextResponse.json({ chronology });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
