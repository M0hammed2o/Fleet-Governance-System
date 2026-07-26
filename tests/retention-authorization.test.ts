import { describe, it, expect } from "vitest";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser, grantPermission } from "./helpers/fixtures";

async function makeSession(tenantId: string, roleId: string, userId: string): Promise<AuthenticatedSession> {
  return { sessionId: "n/a", tenantId, userId, roleId, roleName: "Test Role", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
}

describe("retention authorization — wrong role cannot act (Phase 8C)", () => {
  it("a VIEW-only role cannot initiate, approve, configure, or export", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Retention Viewer");
    await grantPermission(role.id, "retention", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "retention", "VIEW")).toBe(true);
    expect(await hasPermission(session, "retention", "CREATE")).toBe(false);
    expect(await hasPermission(session, "retention", "APPROVE")).toBe(false);
    expect(await hasPermission(session, "retention", "CONFIGURE")).toBe(false);
    expect(await hasPermission(session, "retention", "EXPORT")).toBe(false);
  });

  it("a Company-Administrator-style role (CREATE + CONFIGURE) cannot approve its own deletion request via the permission system", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Company Admin Style");
    await grantPermission(role.id, "retention", "VIEW");
    await grantPermission(role.id, "retention", "CREATE");
    await grantPermission(role.id, "retention", "CONFIGURE");
    await grantPermission(role.id, "retention", "EXPORT");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "retention", "CREATE")).toBe(true);
    expect(await hasPermission(session, "retention", "APPROVE")).toBe(false);
  });

  it("an approver-style role (VIEW + APPROVE only) cannot initiate a deletion request or configure policy", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Approver Style");
    await grantPermission(role.id, "retention", "VIEW");
    await grantPermission(role.id, "retention", "APPROVE");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "retention", "APPROVE")).toBe(true);
    expect(await hasPermission(session, "retention", "CREATE")).toBe(false);
    expect(await hasPermission(session, "retention", "CONFIGURE")).toBe(false);
  });

  it("a role with no retention grant at all cannot even view", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "No Retention Access");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "retention", "VIEW")).toBe(false);
  });
});
