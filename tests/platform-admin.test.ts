import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/auth/authorize";
import { ForbiddenError } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import {
  listAllTenantsAsPlatformAdmin,
  createTenantAsPlatformAdmin,
  setTenantStatusAsPlatformAdmin,
} from "@/lib/repositories/platform-tenant-repository";
import { createTenant, createRole, createUser, grantPermission, deleteTenantForCleanup } from "./helpers/fixtures";

async function makeSession(roleName: string, permissions: Array<[string, string]> = []) {
  const tenant = await createTenant(roleName);
  const role = await createRole(tenant.id, roleName);
  for (const [resource, action] of permissions) {
    await grantPermission(role.id, resource, action);
  }
  const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const session: AuthenticatedSession = {
    sessionId: "n/a",
    tenantId: tenant.id,
    userId: user.id,
    roleId: role.id,
    roleName,
    userStatus: "ACTIVE",
    tenantStatus: "ACTIVE",
  };
  return { tenant, role, user, session };
}

describe("Platform Administrator cross-tenant access is explicit, restricted, and audited", () => {
  it("a Platform Administrator role has zero permissions on ordinary business resources", async () => {
    const { session } = await makeSession("Platform Administrator", [
      ["platformTenant", "VIEW"],
      ["platformTenant", "CREATE"],
      ["platformTenant", "CONFIGURE"],
    ]);

    expect(await hasPermission(session, "site", "VIEW")).toBe(false);
    expect(await hasPermission(session, "gate", "VIEW")).toBe(false);
    expect(await hasPermission(session, "user", "VIEW")).toBe(false);
    expect(await hasPermission(session, "auditLog", "VIEW")).toBe(false);
  });

  it("an ordinary Company Administrator (no platformTenant permission) cannot list, create, or suspend tenants", async () => {
    const { session } = await makeSession("Company Administrator", [
      ["site", "VIEW"],
      ["user", "VIEW"],
    ]);

    await expect(listAllTenantsAsPlatformAdmin(session)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTenantAsPlatformAdmin(session, { name: "Rogue Co", slug: `rogue-${crypto.randomUUID()}` })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const otherTenant = await createTenant("Victim Tenant");
    await expect(setTenantStatusAsPlatformAdmin(session, otherTenant.id, "SUSPENDED")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("listing tenants as a Platform Administrator writes an audit row scoped to the admin's own tenant", async () => {
    const { session, tenant: platformTenant } = await makeSession("Platform Administrator", [
      ["platformTenant", "VIEW"],
    ]);

    await listAllTenantsAsPlatformAdmin(session);

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId: platformTenant.id, action: "platform.tenant.list" },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0].userId).toBe(session.userId);
  });

  it("suspending a tenant as Platform Administrator is audited with before/after status", async () => {
    const { session, tenant: platformTenant } = await makeSession("Platform Administrator", [
      ["platformTenant", "CONFIGURE"],
    ]);
    const target = await createTenant("Target Tenant");

    const updated = await setTenantStatusAsPlatformAdmin(session, target.id, "SUSPENDED");
    expect(updated.status).toBe("SUSPENDED");

    const auditRow = await prisma.auditLog.findFirst({
      where: { tenantId: platformTenant.id, action: "platform.tenant.status_changed", entityId: target.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.beforeValue).toEqual({ status: "ACTIVE" });
    expect(auditRow?.afterValue).toEqual({ status: "SUSPENDED" });
  });

  it("creating a tenant as Platform Administrator is audited and does not touch the platform tenant's own status", async () => {
    const { session, tenant: platformTenant } = await makeSession("Platform Administrator", [
      ["platformTenant", "CREATE"],
    ]);

    const created = await createTenantAsPlatformAdmin(session, {
      name: "New Co",
      slug: `new-co-${crypto.randomUUID()}`,
    });

    const auditRow = await prisma.auditLog.findFirst({
      where: { tenantId: platformTenant.id, action: "platform.tenant.created", entityId: created.id },
    });
    expect(auditRow).not.toBeNull();

    const unchangedPlatformTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: platformTenant.id } });
    expect(unchangedPlatformTenant.status).toBe("ACTIVE");

    // Created via the real repository function, not the createTenant()
    // fixture helper, so it isn't tracked/cleaned automatically (Phase 8E-007).
    await deleteTenantForCleanup(created.id);
  });
});
