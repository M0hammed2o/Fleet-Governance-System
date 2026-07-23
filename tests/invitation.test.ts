import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createInvitation, validateInvitationToken, markInvitationAccepted } from "@/lib/auth/invitation";
import { createTenant, createRole, createUser } from "./helpers/fixtures";

describe("invitation tokens", () => {
  it("a freshly created invitation validates successfully", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const inviter = await createUser({ tenantId: tenant.id, roleId: role.id, email: "inviter@example.test" });

    const { token, userId } = await createInvitation({
      tenantId: tenant.id,
      invitedById: inviter.id,
      roleId: role.id,
      email: "invitee@example.test",
      name: "Invitee",
    });

    const result = await validateInvitationToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invitation.userId).toBe(userId);
      expect(result.invitation.tenantId).toBe(tenant.id);
    }
  });

  it("rejects an unknown token", async () => {
    const result = await validateInvitationToken("not-a-real-token");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a token that has already been accepted", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const inviter = await createUser({ tenantId: tenant.id, roleId: role.id, email: "inviter2@example.test" });
    const { token } = await createInvitation({
      tenantId: tenant.id,
      invitedById: inviter.id,
      roleId: role.id,
      email: "invitee2@example.test",
      name: "Invitee",
    });

    const first = await validateInvitationToken(token);
    if (first.ok) await markInvitationAccepted(first.invitation.invitationId);

    const second = await validateInvitationToken(token);
    expect(second).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("rejects an expired token", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const inviter = await createUser({ tenantId: tenant.id, roleId: role.id, email: "inviter3@example.test" });
    const { token, userId } = await createInvitation({
      tenantId: tenant.id,
      invitedById: inviter.id,
      roleId: role.id,
      email: "invitee3@example.test",
      name: "Invitee",
    });

    await prisma.userInvitation.update({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await validateInvitationToken(token);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a revoked token", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const inviter = await createUser({ tenantId: tenant.id, roleId: role.id, email: "inviter4@example.test" });
    const { token, userId } = await createInvitation({
      tenantId: tenant.id,
      invitedById: inviter.id,
      roleId: role.id,
      email: "invitee4@example.test",
      name: "Invitee",
    });

    await prisma.userInvitation.update({ where: { userId }, data: { revokedAt: new Date() } });

    const result = await validateInvitationToken(token);
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  // Regression coverage: accepting an invitation must not be a way around a
  // Platform Administrator suspending the tenant.
  it("rejects a still-valid token once its tenant is suspended", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const inviter = await createUser({ tenantId: tenant.id, roleId: role.id, email: "inviter5@example.test" });
    const { token } = await createInvitation({
      tenantId: tenant.id,
      invitedById: inviter.id,
      roleId: role.id,
      email: "invitee5@example.test",
      name: "Invitee",
    });

    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "SUSPENDED" } });

    const result = await validateInvitationToken(token);
    expect(result).toEqual({ ok: false, reason: "tenant_inactive" });
  });
});
