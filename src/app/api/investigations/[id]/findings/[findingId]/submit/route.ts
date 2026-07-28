import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { submitFindingForApproval } from "@/lib/repositories/investigation-finding-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; findingId: string }> }) {
  try {
    const session = await requireApiSession();
    const { findingId } = await params;
    const finding = await submitFindingForApproval(session, findingId);
    return NextResponse.json({ finding });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
