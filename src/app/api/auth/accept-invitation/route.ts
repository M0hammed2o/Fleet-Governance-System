import { NextResponse } from "next/server";
import { acceptInvitationSchema } from "@/lib/validation/auth";
import { validateInvitationToken, markInvitationAccepted } from "@/lib/auth/invitation";
import { hashPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/record-audit";
import { prisma } from "@/lib/db/prisma";

const FAILURE_MESSAGES: Record<string, string> = {
  not_found: "This invitation link is invalid.",
  already_accepted: "This invitation has already been used.",
  revoked: "This invitation has been revoked.",
  expired: "This invitation has expired. Ask your administrator to send a new one.",
  tenant_inactive: "This invitation can no longer be used.",
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = acceptInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const validation = await validateInvitationToken(token);
  if (!validation.ok) {
    return NextResponse.json({ error: FAILURE_MESSAGES[validation.reason] }, { status: 400 });
  }

  const { invitation } = validation;
  const passwordHash = await hashPassword(password);

  await prisma.user.update({
    where: { id: invitation.userId },
    data: { passwordHash, status: "ACTIVE" },
  });
  await markInvitationAccepted(invitation.invitationId);

  await recordAudit({
    tenantId: invitation.tenantId,
    userId: invitation.userId,
    action: "user.invitation.accepted",
    entityType: "User",
    entityId: invitation.userId,
  });

  const ip = request.headers.get("x-forwarded-for") ?? null;
  const userAgent = request.headers.get("user-agent");
  const sessionToken = await createSession({
    tenantId: invitation.tenantId,
    userId: invitation.userId,
    ip,
    userAgent,
  });
  await setSessionCookie(sessionToken);

  return NextResponse.json({ ok: true });
}
