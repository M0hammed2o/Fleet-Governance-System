import { describe, it, expect } from "vitest";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser, grantPermission } from "./helpers/fixtures";

/**
 * Segregation-of-duties tests for the 2026-07-23 nine-role structure
 * (DECISIONS.md D-015, prisma/seed.ts TENANT_ROLE_DEFINITIONS). Each test
 * grants a role exactly the permissions seed.ts grants that role, then
 * asserts the specific prohibited actions remain blocked — proving the
 * remap didn't accidentally widen anyone's access. Deliberately grants
 * permissions ad hoc (not by importing prisma/seed.ts, which is a
 * self-executing script) so the seeded matrix and this test can diverge
 * loudly (a failing test) rather than silently if seed.ts changes without a
 * matching test update.
 */
async function sessionFor(tenantId: string, roleId: string, userId: string): Promise<AuthenticatedSession> {
  return { sessionId: "n/a", tenantId, userId, roleId, roleName: "Test Role", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
}

describe("role segregation of duties (nine-role structure)", () => {
  it("Dispatch and Logistics Officer can create/edit movements but cannot approve or reject them", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Dispatch and Logistics Officer");
    await grantPermission(role.id, "movement", "VIEW");
    await grantPermission(role.id, "movement", "CREATE");
    await grantPermission(role.id, "movement", "EDIT");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "movement", "CREATE")).toBe(true);
    expect(await hasPermission(session, "movement", "APPROVE")).toBe(false);
    expect(await hasPermission(session, "movement", "REJECT")).toBe(false);
  });

  it("Fleet and GPS Manager can view movements but cannot create or edit them (regression: this permission moved to Dispatch and Logistics Officer)", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Fleet and GPS Manager");
    await grantPermission(role.id, "driver", "EDIT");
    await grantPermission(role.id, "vehicle", "EDIT");
    await grantPermission(role.id, "movement", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "movement", "VIEW")).toBe(true);
    expect(await hasPermission(session, "movement", "CREATE")).toBe(false);
    expect(await hasPermission(session, "movement", "EDIT")).toBe(false);
    expect(await hasPermission(session, "movement", "APPROVE")).toBe(false);
  });

  it("Gate Security Officer can raise exceptions and request facial-verification fallback but cannot resolve/approve either", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Gate Security Officer");
    await grantPermission(role.id, "exception", "VIEW");
    await grantPermission(role.id, "exception", "CREATE");
    await grantPermission(role.id, "facialVerificationFallback", "VIEW");
    await grantPermission(role.id, "facialVerificationFallback", "CREATE");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "exception", "CREATE")).toBe(true);
    expect(await hasPermission(session, "exception", "APPROVE")).toBe(false);
    expect(await hasPermission(session, "facialVerificationFallback", "CREATE")).toBe(true);
    expect(await hasPermission(session, "facialVerificationFallback", "APPROVE")).toBe(false);
    expect(await hasPermission(session, "facialVerificationFallback", "REJECT")).toBe(false);
  });

  it("Security Supervisor / Approving Manager can approve movements/exceptions/fallbacks but cannot create a movement or raise an exception themselves", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Security Supervisor / Approving Manager");
    await grantPermission(role.id, "movement", "APPROVE");
    await grantPermission(role.id, "movement", "REJECT");
    await grantPermission(role.id, "exception", "APPROVE");
    await grantPermission(role.id, "facialVerificationFallback", "APPROVE");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "movement", "APPROVE")).toBe(true);
    expect(await hasPermission(session, "movement", "CREATE")).toBe(false);
    expect(await hasPermission(session, "exception", "APPROVE")).toBe(true);
    expect(await hasPermission(session, "exception", "CREATE")).toBe(false);
  });

  it("Accountant / Finance and Compliance Officer can view and verify compliance documents but cannot edit inspections, capture media, or edit audit-adjacent records", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Accountant / Finance and Compliance Officer");
    await grantPermission(role.id, "complianceDocument", "VIEW");
    await grantPermission(role.id, "complianceDocument", "AUDIT");
    await grantPermission(role.id, "auditLog", "VIEW");
    await grantPermission(role.id, "inspectionTemplate", "VIEW");
    await grantPermission(role.id, "mediaAsset", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "complianceDocument", "AUDIT")).toBe(true);
    expect(await hasPermission(session, "inspectionTemplate", "EDIT")).toBe(false);
    expect(await hasPermission(session, "mediaAsset", "CREATE")).toBe(false);
    expect(await hasPermission(session, "complianceDocument", "EDIT")).toBe(false);
    expect(await hasPermission(session, "complianceDocument", "DELETE")).toBe(false);
  });

  it("External Reviewer is more restricted than Internal Investigator / Auditor: no user visibility, no audit export", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "External Reviewer");
    await grantPermission(role.id, "auditLog", "VIEW");
    await grantPermission(role.id, "driver", "VIEW");
    await grantPermission(role.id, "mediaAsset", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "auditLog", "VIEW")).toBe(true);
    expect(await hasPermission(session, "auditLog", "EXPORT")).toBe(false);
    expect(await hasPermission(session, "user", "VIEW")).toBe(false);
  });

  it("Executive Read-Only Viewer has no media/evidence access at all, even VIEW", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Executive Read-Only Viewer");
    await grantPermission(role.id, "driver", "VIEW");
    await grantPermission(role.id, "vehicle", "VIEW");
    await grantPermission(role.id, "movement", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "movement", "VIEW")).toBe(true);
    expect(await hasPermission(session, "mediaAsset", "VIEW")).toBe(false);
    expect(await hasPermission(session, "complianceDocument", "VIEW")).toBe(false);
  });

  it("Company Administrator has broad configuration rights but never mediaAsset:CREATE (cannot silently alter immutable gate evidence)", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Company Administrator");
    await grantPermission(role.id, "user", "CONFIGURE");
    await grantPermission(role.id, "site", "CONFIGURE");
    await grantPermission(role.id, "mediaAsset", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await sessionFor(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "user", "CONFIGURE")).toBe(true);
    expect(await hasPermission(session, "mediaAsset", "VIEW")).toBe(true);
    expect(await hasPermission(session, "mediaAsset", "CREATE")).toBe(false);
    expect(await hasPermission(session, "mediaAsset", "DELETE")).toBe(false);
  });
});
