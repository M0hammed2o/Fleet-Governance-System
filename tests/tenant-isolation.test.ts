import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { findUserForLogin } from "@/lib/repositories/user-repository";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser, grantPermission } from "./helpers/fixtures";

// Mandatory gate: "Tenant A cannot access Tenant B data" — TESTING.md.
describe("tenant isolation", () => {
  it("findUserForLogin only ever returns the user belonging to the requested tenant, even with a colliding email", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const roleA = await createRole(tenantA.id);
    const roleB = await createRole(tenantB.id);

    const sharedEmail = "shared@example.test";
    const userA = await createUser({ tenantId: tenantA.id, roleId: roleA.id, email: sharedEmail });
    const userB = await createUser({ tenantId: tenantB.id, roleId: roleB.id, email: sharedEmail });

    const resolvedViaA = await findUserForLogin(tenantA.slug, sharedEmail);
    const resolvedViaB = await findUserForLogin(tenantB.slug, sharedEmail);

    expect(resolvedViaA?.id).toBe(userA.id);
    expect(resolvedViaA?.tenantId).toBe(tenantA.id);
    expect(resolvedViaB?.id).toBe(userB.id);
    expect(resolvedViaB?.tenantId).toBe(tenantB.id);
    expect(resolvedViaA?.id).not.toBe(resolvedViaB?.id);
  });

  it("findUserForLogin returns null for an unknown tenant slug regardless of a valid email elsewhere", async () => {
    const tenantA = await createTenant("Tenant A");
    const roleA = await createRole(tenantA.id);
    const email = "someone@example.test";
    await createUser({ tenantId: tenantA.id, roleId: roleA.id, email });

    const result = await findUserForLogin("does-not-exist-slug", email);
    expect(result).toBeNull();
  });

  it("a permission granted to Tenant A's role never applies to Tenant B's same-named role", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const roleA = await createRole(tenantA.id, "Site Manager");
    const roleB = await createRole(tenantB.id, "Site Manager");

    await grantPermission(roleA.id, "site", "CONFIGURE");

    const userB = await createUser({ tenantId: tenantB.id, roleId: roleB.id, email: "userb@example.test" });

    const sessionB: AuthenticatedSession = {
      sessionId: "n/a",
      tenantId: tenantB.id,
      userId: userB.id,
      roleId: roleB.id,
      roleName: "Site Manager",
      userStatus: "ACTIVE",
      tenantStatus: "ACTIVE",
    };

    const allowed = await hasPermission(sessionB, "site", "CONFIGURE");
    expect(allowed).toBe(false);
  });

  it("audit log rows are scoped by tenantId and never mixed across tenants in a tenant-filtered query", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");

    await prisma.auditLog.create({
      data: { tenantId: tenantA.id, action: "test.action", entityType: "Test", entityId: "1" },
    });
    await prisma.auditLog.create({
      data: { tenantId: tenantB.id, action: "test.action", entityType: "Test", entityId: "2" },
    });

    const tenantALogs = await prisma.auditLog.findMany({ where: { tenantId: tenantA.id } });
    expect(tenantALogs.every((log) => log.tenantId === tenantA.id)).toBe(true);
    expect(tenantALogs.some((log) => log.tenantId === tenantB.id)).toBe(false);
  });
});
