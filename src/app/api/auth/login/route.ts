import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { findUserForLogin } from "@/lib/repositories/user-repository";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { isEligibleToAuthenticate } from "@/lib/auth/login-eligibility";
import { recordAudit } from "@/lib/audit/record-audit";
import { prisma } from "@/lib/db/prisma";

const GENERIC_ERROR = "Invalid company, email, or password.";
// Valid-shaped bcrypt hash with no known plaintext, compared against when no
// user is found — keeps "no such user" and "wrong password" roughly the same
// latency so responses don't leak which one occurred.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeOZ2gYFH1DkQPBQfvV0KGGrTvHl7yGkC.";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { tenantSlug, email, password } = parsed.data;
  const user = await findUserForLogin(tenantSlug, email);

  const passwordValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !isEligibleToAuthenticate(user) || !passwordValid) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const ip = request.headers.get("x-forwarded-for") ?? null;
  const userAgent = request.headers.get("user-agent");

  const token = await createSession({
    tenantId: user.tenantId,
    userId: user.id,
    ip,
    userAgent,
  });
  await setSessionCookie(token);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    tenantId: user.tenantId,
    userId: user.id,
    ip,
    action: "auth.login",
    entityType: "User",
    entityId: user.id,
  });

  return NextResponse.json({ ok: true });
}
