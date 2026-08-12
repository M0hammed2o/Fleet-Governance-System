import { NextResponse } from "next/server";
import {
  requireMobileSession,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { revokeSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/record-audit";
export async function POST(request: Request) {
  try {
    const session = await requireMobileSession(request);
    await revokeSession(session.sessionId);
    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.sessionId,
      action: "auth.mobileLogout",
      entityType: "User",
      entityId: session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
