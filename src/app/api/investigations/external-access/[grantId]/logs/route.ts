import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { listAccessLogsForGrant } from "@/lib/repositories/external-auditor-access-repository";

export async function GET(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  try {
    const session = await requireApiSession();
    const { grantId } = await params;
    const logs = await listAccessLogsForGrant(session, grantId);
    return NextResponse.json({ logs });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
