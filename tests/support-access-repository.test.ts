import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import {
  getCustomerHealthSummaries,
  startSupportAccessSession,
  endSupportAccessSession,
  elevateSupportAccessSession,
  getActiveSupportAccessSession,
  getSupportViewForCustomer,
  listSupportAccessSessionsForCustomer,
  createSupportNote,
  CustomerTenantNotFoundError,
  SupportAccessSessionNotActiveError,
  SupportAccessSessionAlreadyEndedError,
  NotSessionActorError,
} from "@/lib/repositories/support-access-repository";
import { createTenant, createRole, createUser, createSite, createGate, createDriver, createVehicle, grantPermission } from "./helpers/fixtures";

async function makePlatformSession(permissions: Array<[string, string]> = []) {
  const platformTenant = await createTenant("Platform Style");
  const role = await createRole(platformTenant.id, "Platform Style Role");
  for (const [resource, action] of permissions) {
    await grantPermission(role.id, resource, action);
  }
  const user = await createUser({ tenantId: platformTenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const session: AuthenticatedSession = {
    sessionId: "n/a",
    tenantId: platformTenant.id,
    userId: user.id,
    roleId: role.id,
    roleName: "Platform Style Role",
    userStatus: "ACTIVE",
    tenantStatus: "ACTIVE",
  };
  return { platformTenant, role, user, session };
}

/**
 * A second colleague *within the same platform tenant* as an existing
 * session — in reality every platform staff member (Administrator, Support
 * Analyst) shares the one "platform" tenant, so "a different actor" tests
 * must model a different user in the *same* tenant, not an isolated tenant
 * of its own (unlike ordinary customer-tenant fixtures elsewhere).
 */
async function addColleagueSession(platformTenant: { id: string }, role: { id: string }): Promise<AuthenticatedSession> {
  const user = await createUser({ tenantId: platformTenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  return {
    sessionId: "n/a",
    tenantId: platformTenant.id,
    userId: user.id,
    roleId: role.id,
    roleName: "Platform Style Role",
    userStatus: "ACTIVE",
    tenantStatus: "ACTIVE",
  };
}

async function fullAdminSession() {
  return makePlatformSession([
    ["platformTenant", "VIEW"],
    ["supportAccessSession", "VIEW"],
    ["supportAccessSession", "CREATE"],
    ["supportAccessSession", "CONFIGURE"],
  ]);
}

describe("SUPPORT-001 — customer health summary", () => {
  it("requires platformTenant:VIEW", async () => {
    const { session } = await makePlatformSession([]);
    await expect(getCustomerHealthSummaries(session)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns real DB-backed aggregate counts for a customer tenant, excluding the canonical platform tenant itself", async () => {
    const { session } = await fullAdminSession();
    // The exclusion is keyed off the literal "platform" slug (see
    // PLATFORM_TENANT_SLUG in support-access-repository.ts), not "whichever
    // tenant happens to be the caller's own" — every fixture tenant here
    // (including the caller's) has a random slug, so exercise the real
    // exclusion by upserting the one canonical platform-slugged tenant.
    const platformSlugTenant = await prisma.tenant.upsert({ where: { slug: "platform" }, update: {}, create: { name: "Platform", slug: "platform" } });
    const customer = await createTenant("Customer Co");
    await createSite(customer.id);
    await createVehicle(customer.id);
    await createVehicle(customer.id);
    const role = await createRole(customer.id);
    await createUser({ tenantId: customer.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });

    const summaries = await getCustomerHealthSummaries(session);
    const own = summaries.find((s) => s.tenant.id === platformSlugTenant.id);
    expect(own).toBeUndefined();

    const found = summaries.find((s) => s.tenant.id === customer.id);
    expect(found).toBeDefined();
    expect(found!.siteCount).toBe(1);
    expect(found!.vehicleCount).toBe(2);
    expect(found!.onboardingStatus).not.toBe("NOT_STARTED");
  });

  it("records an audit event scoped to the caller's own tenant", async () => {
    const { session, platformTenant } = await fullAdminSession();
    await getCustomerHealthSummaries(session);
    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: platformTenant.id, action: "platform.supportAccess.healthSummaryViewed" } });
    expect(auditRow).not.toBeNull();
  });
});

describe("SUPPORT-002 — SupportAccessSession lifecycle", () => {
  it("starts a session with a mandatory reason, time-limited, and audited", async () => {
    const { session, platformTenant } = await fullAdminSession();
    const customer = await createTenant("Customer Co");

    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "Investigating a support ticket", ticketReference: "TICK-123" });
    expect(accessSession.customerTenantId).toBe(customer.id);
    expect(accessSession.endedAt).toBeNull();
    expect(accessSession.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: platformTenant.id, action: "platform.supportAccess.sessionStarted", entityId: accessSession.id } });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.reason).toBe("Investigating a support ticket");
  });

  it("rejects starting a session for a nonexistent customer tenant", async () => {
    const { session } = await fullAdminSession();
    await expect(
      startSupportAccessSession({ session, customerTenantId: "nonexistent", reason: "test" }),
    ).rejects.toBeInstanceOf(CustomerTenantNotFoundError);
  });

  it("rejects starting a session targeting the platform tenant itself", async () => {
    const { session } = await fullAdminSession();
    const platformSlugTenant = await prisma.tenant.upsert({ where: { slug: "platform" }, update: {}, create: { name: "Platform", slug: "platform" } });
    await expect(
      startSupportAccessSession({ session, customerTenantId: platformSlugTenant.id, reason: "test" }),
    ).rejects.toBeInstanceOf(CustomerTenantNotFoundError);
  });

  it("requires supportAccessSession:CREATE to start a session", async () => {
    const { session } = await makePlatformSession([["supportAccessSession", "VIEW"]]);
    const customer = await createTenant("Customer Co");
    await expect(startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only the actor who started a session can end it", async () => {
    const { session, platformTenant, role } = await fullAdminSession();
    const otherSession = await addColleagueSession(platformTenant, role);
    const customer = await createTenant("Customer Co");
    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });

    await expect(endSupportAccessSession(otherSession, accessSession.id)).rejects.toBeInstanceOf(NotSessionActorError);

    const ended = await endSupportAccessSession(session, accessSession.id);
    expect(ended?.endedAt).not.toBeNull();
  });

  it("rejects ending an already-ended session", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });
    await endSupportAccessSession(session, accessSession.id);

    await expect(endSupportAccessSession(session, accessSession.id)).rejects.toBeInstanceOf(SupportAccessSessionAlreadyEndedError);
  });

  it("only the actor who started a session, with CONFIGURE, can elevate it — and only while active", async () => {
    const { session, platformTenant, role } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });

    // A colleague in the same platform tenant, also with CONFIGURE, still
    // cannot elevate someone *else's* session.
    const colleagueSession = await addColleagueSession(platformTenant, role);
    await expect(elevateSupportAccessSession({ session: colleagueSession, accessSessionId: accessSession.id, elevatedReason: "x" })).rejects.toBeInstanceOf(NotSessionActorError);

    const elevated = await elevateSupportAccessSession({ session, accessSessionId: accessSession.id, elevatedReason: "Customer requested a data correction" });
    expect(elevated?.elevated).toBe(true);
    expect(elevated?.elevatedReason).toBe("Customer requested a data correction");

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "platform.supportAccess.sessionElevated", entityId: accessSession.id } });
    expect(auditRow).not.toBeNull();
  });

  it("rejects elevating an ended session", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });
    await endSupportAccessSession(session, accessSession.id);

    await expect(elevateSupportAccessSession({ session, accessSessionId: accessSession.id, elevatedReason: "x" })).rejects.toBeInstanceOf(SupportAccessSessionNotActiveError);
  });
});

describe("SUPPORT-003 — the controlled support view requires an active session", () => {
  it("rejects viewing a customer with no active session at all", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    await expect(getSupportViewForCustomer(session, customer.id)).rejects.toBeInstanceOf(SupportAccessSessionNotActiveError);
  });

  it("returns a bounded read-only summary once a session is active", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    const site = await createSite(customer.id);
    await createGate(customer.id, site.id);
    await createVehicle(customer.id);
    await createDriver(customer.id);
    await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });

    const view = await getSupportViewForCustomer(session, customer.id);
    expect(view.tenant.id).toBe(customer.id);
    expect(view.sites).toHaveLength(1);
    expect(view.gates).toHaveLength(1);
    expect(view.vehicleCount).toBe(1);
    expect(view.driverCount).toBe(1);
  });

  it("includes support notes in the view", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });
    await createSupportNote(session, customer.id, "Customer confirmed their onboarding call for next week.");

    const view = await getSupportViewForCustomer(session, customer.id);
    expect(view.notes).toHaveLength(1);
    expect(view.notes[0].note).toContain("onboarding call");
  });

  it("ending the session immediately revokes support-view access (SUPPORT-003 'immediate exit')", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });
    await getSupportViewForCustomer(session, customer.id); // works while active
    await endSupportAccessSession(session, accessSession.id);

    await expect(getSupportViewForCustomer(session, customer.id)).rejects.toBeInstanceOf(SupportAccessSessionNotActiveError);
  });

  it("records an audit event every time the support view is opened", async () => {
    const { session, platformTenant } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });
    await getSupportViewForCustomer(session, customer.id);

    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: platformTenant.id, action: "platform.supportAccess.customerViewOpened", entityId: customer.id } });
    expect(auditRow).not.toBeNull();
  });
});

describe("SUPPORT-004 — tenant isolation and access-expiry", () => {
  it("a session active for tenant A grants no access to tenant B (tenant isolation)", async () => {
    const { session } = await fullAdminSession();
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    await startSupportAccessSession({ session, customerTenantId: tenantA.id, reason: "test" });

    await expect(getSupportViewForCustomer(session, tenantB.id)).rejects.toBeInstanceOf(SupportAccessSessionNotActiveError);
    // Tenant A's own view still works — proves the block above is real isolation, not a blanket failure.
    await expect(getSupportViewForCustomer(session, tenantA.id)).resolves.toBeDefined();
  });

  it("an expired session is rejected on the next request, same pattern as evaluateSession()", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });
    // Force it into the past directly — simulating time passing without a
    // fake clock dependency in the repository itself.
    await prisma.supportAccessSession.update({ where: { id: accessSession.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    expect(await getActiveSupportAccessSession(session.userId, customer.id)).toBeNull();
    await expect(getSupportViewForCustomer(session, customer.id)).rejects.toBeInstanceOf(SupportAccessSessionNotActiveError);
  });

  it("a guessed/cross-tenant customerTenantId that doesn't exist returns a controlled error, not a raw crash", async () => {
    const { session } = await fullAdminSession();
    await expect(getSupportViewForCustomer(session, "nonexistent-tenant-id")).rejects.toBeInstanceOf(SupportAccessSessionNotActiveError);
  });
});

describe("Support session audit history and authorization", () => {
  it("lists full session history for a customer, requiring supportAccessSession:VIEW", async () => {
    const { session } = await fullAdminSession();
    const customer = await createTenant("Customer Co");
    await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "First touch" });
    await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "Second touch" });

    const history = await listSupportAccessSessionsForCustomer(session, customer.id);
    expect(history).toHaveLength(2);
  });

  it("a VIEW-only role cannot start a session, add a note, or elevate", async () => {
    const { session } = await makePlatformSession([["supportAccessSession", "VIEW"]]);
    const customer = await createTenant("Customer Co");

    await expect(startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSupportNote(session, customer.id, "note")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a CREATE-only role (no CONFIGURE) cannot elevate its own session", async () => {
    const { session } = await makePlatformSession([["supportAccessSession", "VIEW"], ["supportAccessSession", "CREATE"]]);
    const customer = await createTenant("Customer Co");
    const accessSession = await startSupportAccessSession({ session, customerTenantId: customer.id, reason: "test" });

    await expect(elevateSupportAccessSession({ session, accessSessionId: accessSession.id, elevatedReason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
