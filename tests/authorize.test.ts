import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser, grantPermission } from "./helpers/fixtures";

async function sessionFor(tenantId: string, roleId: string, userId: string): Promise<AuthenticatedSession> {
  return {
    sessionId: "n/a",
    tenantId,
    userId,
    roleId,
    roleName: "Test Role",
    userStatus: "ACTIVE",
    tenantStatus: "ACTIVE",
  };
}

describe("hasPermission precedence", () => {
  it("denies when neither role nor override grants the permission", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: "a@example.test" });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "site", "VIEW")).toBe(false);
  });

  it("allows when the role has the permission", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    await grantPermission(role.id, "site", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: "b@example.test" });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "site", "VIEW")).toBe(true);
  });

  it("an explicit per-user REVOKE override wins even when the role grants the permission", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    await grantPermission(role.id, "site", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: "c@example.test" });

    const permission = await prisma.permission.findUniqueOrThrow({
      where: { resource_action: { resource: "site", action: "VIEW" } },
    });
    await prisma.userPermissionOverride.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        permissionId: permission.id,
        effect: "REVOKE",
        reason: "test: explicit revoke",
        grantedBy: "test-suite",
      },
    });

    const session = await sessionFor(tenant.id, role.id, user.id);
    expect(await hasPermission(session, "site", "VIEW")).toBe(false);
  });

  it("an explicit per-user GRANT override allows access without a role permission", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: "d@example.test" });

    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource: "gate", action: "CONFIGURE" } },
      update: {},
      create: { resource: "gate", action: "CONFIGURE" },
    });
    await prisma.userPermissionOverride.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        permissionId: permission.id,
        effect: "GRANT",
        reason: "test: explicit grant",
        grantedBy: "test-suite",
      },
    });

    const session = await sessionFor(tenant.id, role.id, user.id);
    expect(await hasPermission(session, "gate", "CONFIGURE")).toBe(true);
  });

  it("an active approval delegation grants the delegated scope to the delegate", async () => {
    const tenant = await createTenant();
    const delegatorRole = await createRole(tenant.id, "Approving Manager");
    const delegateRole = await createRole(tenant.id, "Gate Security Officer");
    const delegator = await createUser({ tenantId: tenant.id, roleId: delegatorRole.id, email: "e1@example.test" });
    const delegate = await createUser({ tenantId: tenant.id, roleId: delegateRole.id, email: "e2@example.test" });

    await prisma.approvalDelegation.create({
      data: {
        tenantId: tenant.id,
        delegatorId: delegator.id,
        delegateId: delegate.id,
        permissionScope: "gate:CONFIGURE",
        startAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const session = await sessionFor(tenant.id, delegateRole.id, delegate.id);
    expect(await hasPermission(session, "gate", "CONFIGURE")).toBe(true);
  });

  it("an expired approval delegation grants nothing", async () => {
    const tenant = await createTenant();
    const delegatorRole = await createRole(tenant.id, "Approving Manager");
    const delegateRole = await createRole(tenant.id, "Gate Security Officer");
    const delegator = await createUser({ tenantId: tenant.id, roleId: delegatorRole.id, email: "f1@example.test" });
    const delegate = await createUser({ tenantId: tenant.id, roleId: delegateRole.id, email: "f2@example.test" });

    await prisma.approvalDelegation.create({
      data: {
        tenantId: tenant.id,
        delegatorId: delegator.id,
        delegateId: delegate.id,
        permissionScope: "gate:CONFIGURE",
        startAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const session = await sessionFor(tenant.id, delegateRole.id, delegate.id);
    expect(await hasPermission(session, "gate", "CONFIGURE")).toBe(false);
  });
});
