import { describe, it, expect } from "vitest";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser, grantPermission } from "./helpers/fixtures";

async function makeSession(tenantId: string, roleId: string, userId: string): Promise<AuthenticatedSession> {
  return { sessionId: "n/a", tenantId, userId, roleId, roleName: "Test Role", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
}

describe("reconciliation authorization — wrong role cannot act", () => {
  it("a role granted only reconciliation:VIEW cannot build, explain, or resolve", async () => {
    const tenant = await createTenant();
    const viewerRole = await createRole(tenant.id, "Reconciliation Viewer");
    await grantPermission(viewerRole.id, "reconciliation", "VIEW");
    const viewer = await createUser({ tenantId: tenant.id, roleId: viewerRole.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, viewerRole.id, viewer.id);

    expect(await hasPermission(session, "reconciliation", "VIEW")).toBe(true);
    expect(await hasPermission(session, "reconciliation", "CREATE")).toBe(false);
    expect(await hasPermission(session, "reconciliation", "EDIT")).toBe(false);
    expect(await hasPermission(session, "reconciliation", "APPROVE")).toBe(false);
  });

  it("a gate-officer-style role (VIEW + CREATE only) cannot resolve a discrepancy", async () => {
    const tenant = await createTenant();
    const officerRole = await createRole(tenant.id, "Gate Officer Style");
    await grantPermission(officerRole.id, "reconciliation", "VIEW");
    await grantPermission(officerRole.id, "reconciliation", "CREATE");
    const officer = await createUser({ tenantId: tenant.id, roleId: officerRole.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, officerRole.id, officer.id);

    expect(await hasPermission(session, "reconciliation", "CREATE")).toBe(true);
    expect(await hasPermission(session, "reconciliation", "APPROVE")).toBe(false);
  });

  it("a supervisor-style role (VIEW + EDIT + APPROVE) can resolve", async () => {
    const tenant = await createTenant();
    const supervisorRole = await createRole(tenant.id, "Supervisor Style");
    await grantPermission(supervisorRole.id, "reconciliation", "VIEW");
    await grantPermission(supervisorRole.id, "reconciliation", "EDIT");
    await grantPermission(supervisorRole.id, "reconciliation", "APPROVE");
    const supervisor = await createUser({ tenantId: tenant.id, roleId: supervisorRole.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, supervisorRole.id, supervisor.id);

    expect(await hasPermission(session, "reconciliation", "APPROVE")).toBe(true);
  });

  it("a role with no reconciliation grants at all cannot even view", async () => {
    const tenant = await createTenant();
    const noneRole = await createRole(tenant.id, "No Reconciliation Access");
    const user = await createUser({ tenantId: tenant.id, roleId: noneRole.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, noneRole.id, user.id);

    expect(await hasPermission(session, "reconciliation", "VIEW")).toBe(false);
  });
});
