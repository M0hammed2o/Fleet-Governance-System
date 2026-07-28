import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { listReportsForAuditor } from "@/lib/repositories/external-auditor-access-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const reports = await listReportsForAuditor(session, id);
    return NextResponse.json({ reports });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
