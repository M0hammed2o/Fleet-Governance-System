import { describe, it, expect } from "vitest";
import { isEligibleToAuthenticate } from "@/lib/auth/login-eligibility";
import { prisma } from "@/lib/db/prisma";
import { findUserForLogin } from "@/lib/repositories/user-repository";
import { createTenant, createRole, createUser } from "./helpers/fixtures";

describe("isEligibleToAuthenticate", () => {
  it("allows an active user in an active tenant", () => {
    expect(isEligibleToAuthenticate({ status: "ACTIVE", tenant: { status: "ACTIVE" } })).toBe(true);
  });

  it("rejects a suspended user even in an active tenant", () => {
    expect(isEligibleToAuthenticate({ status: "SUSPENDED", tenant: { status: "ACTIVE" } })).toBe(false);
  });

  it("rejects an active user whose tenant is suspended", () => {
    expect(isEligibleToAuthenticate({ status: "ACTIVE", tenant: { status: "SUSPENDED" } })).toBe(false);
  });

  it("rejects an invited (not yet activated) user", () => {
    expect(isEligibleToAuthenticate({ status: "INVITED", tenant: { status: "ACTIVE" } })).toBe(false);
  });
});

// Regression coverage for a real bug found in manual testing: the login route
// originally only checked user.status, so a user of a SUSPENDED tenant could
// still start a brand-new session even though an *existing* session for that
// tenant was already correctly rejected by evaluateSession().
describe("suspending a tenant blocks new logins for its users (integration)", () => {
  it("findUserForLogin still returns the user, but isEligibleToAuthenticate rejects once the tenant is suspended", async () => {
    const tenant = await createTenant("Suspend Me Inc");
    const role = await createRole(tenant.id);
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: "tenant-suspend@example.test" });

    const beforeSuspend = await findUserForLogin(tenant.slug, user.email);
    expect(beforeSuspend).not.toBeNull();
    expect(isEligibleToAuthenticate(beforeSuspend!)).toBe(true);

    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "SUSPENDED" } });

    const afterSuspend = await findUserForLogin(tenant.slug, user.email);
    expect(afterSuspend).not.toBeNull(); // user row is unchanged...
    expect(isEligibleToAuthenticate(afterSuspend!)).toBe(false); // ...but login must refuse it
  });
});
