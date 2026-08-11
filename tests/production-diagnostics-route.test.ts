import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const cookieState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => cookieState.token ? { value: cookieState.token } : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { GET as getDiagnostics } from "@/app/api/platform/diagnostics/route";
import { createSession } from "@/lib/auth/session";
import { createRole, createTenant, createUser, grantPermission } from "./helpers/fixtures";

afterEach(() => {
  cookieState.token = null;
});

async function loginWithPermissions(permissions: Array<[string, string]>): Promise<void> {
  const tenant = await createTenant("Platform diagnostics tenant");
  const role = await createRole(tenant.id, `role-${crypto.randomUUID()}`);
  for (const [resource, action] of permissions) await grantPermission(role.id, resource, action);
  const user = await createUser({
    tenantId: tenant.id,
    roleId: role.id,
    email: `${crypto.randomUUID()}@example.test`,
  });
  cookieState.token = await createSession({ tenantId: tenant.id, userId: user.id });
}

describe("Phase 13A detailed diagnostics permission boundary", () => {
  it("rejects an unauthenticated request without exposing diagnostics", async () => {
    const response = await getDiagnostics();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
  });

  it("rejects an authenticated tenant user without platform configuration permission", async () => {
    await loginWithPermissions([["vehicle", "VIEW"]]);
    const response = await getDiagnostics();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("returns redacted platform diagnostics to an explicitly authorised platform operator", async () => {
    await loginWithPermissions([["platformTenant", "CONFIGURE"]]);
    const response = await getDiagnostics();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.readiness.items.length).toBeGreaterThan(10);
    expect(body.jobs.length).toBe(13);
    const encoded = JSON.stringify(body);
    expect(encoded).not.toMatch(/postgresql:|DATABASE_URL|SESSION_SECRET|JOB_SCHEDULER_TOKEN|R2_SECRET/i);
    expect(encoded).not.toMatch(/@example\.test/);
  });
});
