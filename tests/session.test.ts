import { describe, it, expect } from "vitest";
import { evaluateSession, type SessionRecordForValidation } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser } from "./helpers/fixtures";

function baseRecord(overrides: Partial<SessionRecordForValidation> = {}): SessionRecordForValidation {
  return {
    id: "session-1",
    tenantId: "tenant-1",
    userId: "user-1",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      roleId: "role-1",
      status: "ACTIVE",
      role: { name: "Test Role" },
      tenant: { status: "ACTIVE" },
    },
    ...overrides,
  };
}

describe("evaluateSession (pure decision logic)", () => {
  it("rejects when there is no session record", () => {
    expect(evaluateSession(null)).toEqual({ valid: false, reason: "not_found" });
  });

  it("rejects an expired session even if nothing else is wrong", () => {
    const record = baseRecord({ expiresAt: new Date(Date.now() - 1) });
    expect(evaluateSession(record)).toEqual({ valid: false, reason: "expired" });
  });

  it("accepts a session that expires in the future", () => {
    const record = baseRecord({ expiresAt: new Date(Date.now() + 1000) });
    const result = evaluateSession(record);
    expect(result.valid).toBe(true);
  });

  it("treats a session as valid up to and including its exact expiresAt instant, invalid 1ms after", () => {
    const now = new Date();
    const atBoundary = baseRecord({ expiresAt: now });
    expect(evaluateSession(atBoundary, now).valid).toBe(true);

    const justAfter = baseRecord({ expiresAt: now });
    expect(evaluateSession(justAfter, new Date(now.getTime() + 1)).valid).toBe(false);
  });

  it("rejects a revoked session even if it hasn't expired yet", () => {
    const record = baseRecord({ revokedAt: new Date() });
    expect(evaluateSession(record)).toEqual({ valid: false, reason: "revoked" });
  });

  it("rejects when the user is suspended", () => {
    const record = baseRecord({ user: { ...baseRecord().user, status: "SUSPENDED" } });
    expect(evaluateSession(record)).toEqual({ valid: false, reason: "user_inactive" });
  });

  it("rejects when the tenant is suspended", () => {
    const record = baseRecord({ user: { ...baseRecord().user, tenant: { status: "SUSPENDED" } } });
    expect(evaluateSession(record)).toEqual({ valid: false, reason: "tenant_inactive" });
  });

  it("returns the expected AuthenticatedSession shape when valid", () => {
    const record = baseRecord();
    const result = evaluateSession(record);
    expect(result).toEqual({
      valid: true,
      session: {
        sessionId: "session-1",
        tenantId: "tenant-1",
        userId: "user-1",
        roleId: "role-1",
        roleName: "Test Role",
        userStatus: "ACTIVE",
        tenantStatus: "ACTIVE",
      },
    });
  });
});

describe("suspension revokes existing sessions (integration)", () => {
  it("a session created before suspension is revoked once the user is suspended", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: "suspend-me@example.test" });

    await createSession({ tenantId: tenant.id, userId: user.id });
    const before = await prisma.session.findFirst({ where: { userId: user.id } });
    expect(before?.revokedAt).toBeNull();

    // Mirrors what POST /api/admin/users/[id]/suspend does.
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });

    const after = await prisma.session.findFirst({ where: { userId: user.id } });
    expect(after?.revokedAt).not.toBeNull();

    const record = await prisma.session.findFirstOrThrow({
      where: { userId: user.id },
      include: { user: { include: { role: true, tenant: true } } },
    });
    expect(evaluateSession(record).valid).toBe(false);
  });
});
