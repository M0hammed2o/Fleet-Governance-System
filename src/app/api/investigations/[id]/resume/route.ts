import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { resumeInvestigation } from "@/lib/repositories/investigation-case-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const investigationCase = await resumeInvestigation(session, id);
    return NextResponse.json({ investigationCase });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
