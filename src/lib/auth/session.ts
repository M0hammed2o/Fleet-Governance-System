import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

export const SESSION_COOKIE_NAME = "gfg_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — gate shifts are long; revisit if too short in practice.

type PrismaTx = Pick<PrismaClient, "session">;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Creates a session record and returns the raw bearer token to place in the
 * cookie. Only the SHA-256 hash of the token is persisted — see schema.prisma
 * Session.tokenHash.
 */
export async function createSession(input: CreateSessionInput, tx: PrismaTx = prisma): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await tx.session.create({
    data: {
      tokenHash,
      tenantId: input.tenantId,
      userId: input.userId,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    },
  });

  return token;
}

export interface AuthenticatedSession {
  sessionId: string;
  tenantId: string;
  userId: string;
  roleId: string;
  roleName: string;
  userStatus: string;
  tenantStatus: string;
}

export interface SessionRecordForValidation {
  id: string;
  tenantId: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  user: {
    roleId: string;
    status: string;
    role: { name: string };
    tenant: { status: string };
  };
}

export type SessionInvalidReason = "not_found" | "revoked" | "expired" | "user_inactive" | "tenant_inactive";

export type SessionEvaluation =
  | { valid: true; session: AuthenticatedSession }
  | { valid: false; reason: SessionInvalidReason };

/**
 * Pure decision function — no DB, no cookies — so session-expiry/suspension
 * logic can be unit tested directly with fixture objects instead of only
 * through a live cookie + DB round trip. getSession() is the only caller in
 * application code; tests call this directly.
 */
export function evaluateSession(
  record: SessionRecordForValidation | null,
  now: Date = new Date(),
): SessionEvaluation {
  if (!record) return { valid: false, reason: "not_found" };
  if (record.revokedAt) return { valid: false, reason: "revoked" };
  if (record.expiresAt.getTime() < now.getTime()) return { valid: false, reason: "expired" };
  // Kept as two explicit checks (rather than the shared isEligibleToAuthenticate
  // helper login/accept-invitation use) so the distinct reason codes below stay
  // meaningful — this function's whole job is telling apart *why* a session
  // is invalid, which a single combined boolean would collapse.
  if (record.user.status !== "ACTIVE") return { valid: false, reason: "user_inactive" };
  if (record.user.tenant.status !== "ACTIVE") return { valid: false, reason: "tenant_inactive" };

  return {
    valid: true,
    session: {
      sessionId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      roleId: record.user.roleId,
      roleName: record.user.role.name,
      userStatus: record.user.status,
      tenantStatus: record.user.tenant.status,
    },
  };
}

/**
 * Reads the session cookie, validates it against the DB (not revoked, not
 * expired, user and tenant both active), and returns the authenticated
 * context — or null if there is no valid session. Every server action / route
 * handler that needs auth should call this rather than trusting the cookie's
 * mere presence.
 */
export async function getSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const record = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { role: true, tenant: true } } },
  });

  const evaluation = evaluateSession(record);
  return evaluation.valid ? evaluation.session : null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/** Revokes the session in the DB. Call before/alongside clearSessionCookie(). */
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every active session for a user — used on password reset / suspension. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
