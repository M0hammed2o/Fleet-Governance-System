import { describe, it, expect } from "vitest";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser, grantPermission } from "./helpers/fixtures";

async function makeSession(tenantId: string, roleId: string, userId: string): Promise<AuthenticatedSession> {
  return { sessionId: "n/a", tenantId, userId, roleId, roleName: "Test Role", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
}

describe("telematics/vehicleUsePolicy authorization — wrong role cannot act", () => {
  it("a VIEW-only role cannot sync telematics, configure geofences, or resolve confirmations", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Telematics Viewer");
    await grantPermission(role.id, "telematics", "VIEW");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "telematics", "VIEW")).toBe(true);
    expect(await hasPermission(session, "telematics", "CREATE")).toBe(false);
    expect(await hasPermission(session, "telematics", "APPROVE")).toBe(false);
    expect(await hasPermission(session, "telematics", "CONFIGURE")).toBe(false);
  });

  it("a gate-officer-style role (VIEW + CREATE only) cannot approve a manual GPS confirmation", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Officer Style");
    await grantPermission(role.id, "telematics", "VIEW");
    await grantPermission(role.id, "telematics", "CREATE");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "telematics", "CREATE")).toBe(true);
    expect(await hasPermission(session, "telematics", "APPROVE")).toBe(false);
  });

  it("a role with no vehicleUsePolicy grant cannot view, create, or approve policies", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "No Policy Access");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "vehicleUsePolicy", "VIEW")).toBe(false);
    expect(await hasPermission(session, "vehicleUsePolicy", "CREATE")).toBe(false);
    expect(await hasPermission(session, "vehicleUsePolicy", "APPROVE")).toBe(false);
  });

  it("a policy-drafting role (VIEW + CREATE + EDIT) cannot approve its own draft policy via the permission system", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id, "Fleet Manager Style");
    await grantPermission(role.id, "vehicleUsePolicy", "VIEW");
    await grantPermission(role.id, "vehicleUsePolicy", "CREATE");
    await grantPermission(role.id, "vehicleUsePolicy", "EDIT");
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, role.id, user.id);

    expect(await hasPermission(session, "vehicleUsePolicy", "CREATE")).toBe(true);
    expect(await hasPermission(session, "vehicleUsePolicy", "APPROVE")).toBe(false);
  });
});
