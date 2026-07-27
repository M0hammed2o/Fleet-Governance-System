import crypto from "node:crypto";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createTenant, createRole, createUser, grantPermission } from "./fixtures";

/** Same makeSession pattern already used by tests/platform-admin.test.ts / support-access-repository.test.ts — shared here since several Phase 10 billing test files need it identically. */
export async function makeSession(roleName: string, permissions: Array<[string, string]> = []) {
  const tenant = await createTenant(roleName);
  const { role, user, session } = await makeSessionForTenant(tenant, roleName, permissions);
  return { tenant, role, user, session };
}

/** Builds a role/user/session scoped to an *existing* tenant — for tests that need a second, differently-permissioned actor within the same tenant a fixture already created (e.g. the tenant that owns an invoice under test). */
export async function makeSessionForTenant(tenant: { id: string }, roleName: string, permissions: Array<[string, string]> = []) {
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
  return { role, user, session };
}
