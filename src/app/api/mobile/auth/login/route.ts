import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { findUserForLogin } from "@/lib/repositories/user-repository";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, getSessionFromToken } from "@/lib/auth/session";
import { isEligibleToAuthenticate } from "@/lib/auth/login-eligibility";
import {
  checkLoginRateLimit,
  normaliseClientIp,
  recordAuthenticationAttempt,
} from "@/lib/auth/login-rate-limit";
import { recordAudit } from "@/lib/audit/record-audit";
import { prisma } from "@/lib/db/prisma";
import { createMobileBootstrap } from "@/lib/mobile/bootstrap";
import { logger } from "@/lib/observability/logger";

const GENERIC_ERROR = "Invalid company, email, or password.";
const DUMMY_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEeOZ2gYFH1DkQPBQfvV0KGGrTvHl7yGkC.";

export async function POST(request: Request) {
  if (
    process.env.APP_ENV === "production" &&
    process.env.MOBILE_PASSWORD_AUTH_ENABLED !== "true"
  )
    return NextResponse.json(
      {
        error: "Production mobile authentication is not configured.",
        code: "AUTH_UNCONFIGURED",
      },
      { status: 503 },
    );
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid sign-in request.", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  const { tenantSlug, email, password } = parsed.data;
  const ip = normaliseClientIp(request.headers.get("x-forwarded-for"));
  const rateLimit = await checkLoginRateLimit({ tenantSlug, email, ip });
  const user = await findUserForLogin(tenantSlug, email);
  const passwordValid = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );
  if (rateLimit.limited)
    return NextResponse.json(
      {
        error: "Too many sign-in attempts. Try again later.",
        code: "RATE_LIMITED",
      },
      { status: 429 },
    );
  if (!user || !isEligibleToAuthenticate(user) || !passwordValid) {
    await recordAuthenticationAttempt({
      tenantSlug,
      email,
      ip,
      succeeded: false,
    });
    logger.warn("security.mobile_login_failed", {
      identifierHash: rateLimit.identifierHash,
      ipHash: rateLimit.ipHash,
    });
    return NextResponse.json(
      { error: GENERIC_ERROR, code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }
  const token = await createSession({
    tenantId: user.tenantId,
    userId: user.id,
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  const session = await getSessionFromToken(token);
  if (!session) throw new Error("New mobile session could not be validated.");
  await Promise.all([
    recordAuthenticationAttempt({ tenantSlug, email, ip, succeeded: true }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
    recordAudit({
      tenantId: user.tenantId,
      userId: user.id,
      sessionId: session.sessionId,
      ip,
      action: "auth.mobileLogin",
      entityType: "User",
      entityId: user.id,
    }),
  ]);
  return NextResponse.json(
    { token, bootstrap: await createMobileBootstrap(session) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
