import { NextResponse } from "next/server";
import { getSession, revokeSession, clearSessionCookie } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST() {
  const session = await getSession();
  if (session) {
    await revokeSession(session.sessionId);
    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.sessionId,
      action: "auth.logout",
      entityType: "User",
      entityId: session.userId,
    });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
