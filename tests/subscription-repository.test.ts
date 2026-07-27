import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import {
  ensureTenantSubscription,
  activateTenantSubscription,
  getTenantAccessStatus,
  markTenantPastDue,
  suspendTenantSubscription,
  restoreTenantSubscription,
  isEligibleForAutomatedSuspension,
  evaluateAutomatedSuspension,
  TenantSubscriptionNotPastDueError,
  TenantSubscriptionNotSuspendedOrPastDueError,
} from "@/lib/repositories/subscription-repository";
import { createMovement, TenantAccessSuspendedError } from "@/lib/repositories/movement-repository";
import { createTenant, createDriver, createVehicle } from "./helpers/fixtures";
import { makeSessionForTenant } from "./helpers/billing-session";

describe("Phase 10 (P10K): subscription lifecycle and access control", () => {
  it("a new tenant starts PENDING; ACTIVE access status never blocks movement creation", async () => {
    const tenant = await createTenant();
    const subscription = await ensureTenantSubscription(tenant.id);
    expect(subscription.status).toBe("PENDING");

    const status = await getTenantAccessStatus(tenant.id);
    expect(status.blocksNewMovementCreation).toBe(false);
  });

  it("suspension requires PAST_DUE first — cannot suspend directly from ACTIVE/PENDING", async () => {
    const tenant = await createTenant();
    await ensureTenantSubscription(tenant.id);
    await expect(suspendTenantSubscription(tenant.id, "test", null)).rejects.toBeInstanceOf(TenantSubscriptionNotPastDueError);
  });

  it("PAST_DUE is a clear warning only — never blocks movement creation", async () => {
    const tenant = await createTenant();
    await ensureTenantSubscription(tenant.id);
    await activateTenantSubscription(tenant.id, null); // realistic precondition: PAST_DUE is only ever reached from ACTIVE (an issued invoice going overdue), never straight from PENDING
    await markTenantPastDue(tenant.id, null);

    const status = await getTenantAccessStatus(tenant.id);
    expect(status.status).toBe("PAST_DUE_WARNING");
    expect(status.blocksNewMovementCreation).toBe(false);
  });

  it("SUSPENDED blocks new movement creation but does not touch any existing data", async () => {
    const tenant = await createTenant();
    const driver = await createDriver(tenant.id);
    const vehicle = await createVehicle(tenant.id);
    await ensureTenantSubscription(tenant.id);
    await activateTenantSubscription(tenant.id, null); // realistic precondition: PAST_DUE is only ever reached from ACTIVE (an issued invoice going overdue), never straight from PENDING
    await markTenantPastDue(tenant.id, null);
    await suspendTenantSubscription(tenant.id, "grace period elapsed", null);

    const status = await getTenantAccessStatus(tenant.id);
    expect(status.blocksNewMovementCreation).toBe(true);

    const { session } = await makeSessionForTenant(tenant, "Test Dispatcher", []);
    await expect(
      createMovement({ tenantId: tenant.id, siteId: "n/a", vehicleId: vehicle.id, driverId: driver.id, movementType: "DELIVERY", requesterUserId: session.userId }),
    ).rejects.toBeInstanceOf(TenantAccessSuspendedError);

    // Existing rows are completely untouched — suspension never deletes customer data.
    const reloadedDriver = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    const reloadedVehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(reloadedDriver.id).toBe(driver.id);
    expect(reloadedVehicle.id).toBe(vehicle.id);
  });

  it("an explicit platform-admin suspend/restore is permission-gated and audited with the actor recorded", async () => {
    const tenant = await createTenant();
    await ensureTenantSubscription(tenant.id);
    await activateTenantSubscription(tenant.id, null); // realistic precondition: PAST_DUE is only ever reached from ACTIVE (an issued invoice going overdue), never straight from PENDING
    await markTenantPastDue(tenant.id, null);

    const { session: unauthorised } = await makeSessionForTenant(tenant, "Test No Perms", []);
    await expect(suspendTenantSubscription(tenant.id, "test", unauthorised)).rejects.toBeInstanceOf(ForbiddenError);

    const { session: adminSession } = await makeSessionForTenant(tenant, "Platform Administrator", [["tenantSubscription", "CONFIGURE"]]);
    const suspended = await suspendTenantSubscription(tenant.id, "manual suspension", adminSession);
    expect(suspended.status).toBe("SUSPENDED");
    expect(suspended.suspendedByUserId).toBe(adminSession.userId);

    const restored = await restoreTenantSubscription(tenant.id, adminSession);
    expect(restored.status).toBe("ACTIVE");
    expect(restored.restoredByUserId).toBe(adminSession.userId);

    const auditRows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, entityType: "TenantSubscription" }, orderBy: { timestamp: "asc" } });
    expect(auditRows.map((r) => r.action)).toEqual(expect.arrayContaining(["tenantSubscription.pastDue", "tenantSubscription.suspended", "tenantSubscription.restored"]));
  });

  it("an automated suspension (actor null) is still fully audited", async () => {
    const tenant = await createTenant();
    await ensureTenantSubscription(tenant.id);
    await activateTenantSubscription(tenant.id, null); // realistic precondition: PAST_DUE is only ever reached from ACTIVE (an issued invoice going overdue), never straight from PENDING
    await markTenantPastDue(tenant.id, null);
    await suspendTenantSubscription(tenant.id, "automated: grace period elapsed", null);

    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "tenantSubscription.suspended" } });
    expect(auditRow).toBeTruthy();
    expect(auditRow?.userId).toBeNull();
  });

  it("cannot restore an ACTIVE or PENDING subscription (nothing to restore)", async () => {
    const tenant = await createTenant();
    await ensureTenantSubscription(tenant.id);
    await expect(restoreTenantSubscription(tenant.id, null)).rejects.toBeInstanceOf(TenantSubscriptionNotSuspendedOrPastDueError);
  });

  it("isEligibleForAutomatedSuspension is a pure grace-period boundary check", () => {
    const dueDate = new Date("2026-01-01T00:00:00Z");
    expect(isEligibleForAutomatedSuspension(dueDate, 14, new Date("2026-01-14T23:59:59Z"))).toBe(false);
    expect(isEligibleForAutomatedSuspension(dueDate, 14, new Date("2026-01-15T00:00:00Z"))).toBe(true);
    expect(isEligibleForAutomatedSuspension(dueDate, 14, new Date("2026-02-01T00:00:00Z"))).toBe(true);
  });

  it("evaluateAutomatedSuspension only acts on a PAST_DUE tenant whose grace period has genuinely elapsed", async () => {
    const tenant = await createTenant();
    await ensureTenantSubscription(tenant.id);

    // Not PAST_DUE yet — no-op.
    const noop = await evaluateAutomatedSuspension(tenant.id, new Date("2020-01-01"));
    expect(noop).toBe(false);

    await activateTenantSubscription(tenant.id, null);
    await markTenantPastDue(tenant.id, null);
    const tooSoon = await evaluateAutomatedSuspension(tenant.id, new Date(), new Date());
    expect(tooSoon).toBe(false); // due "now", grace period (default 14 days) has not elapsed

    const longOverdue = await evaluateAutomatedSuspension(tenant.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    expect(longOverdue).toBe(true);

    const status = await getTenantAccessStatus(tenant.id);
    expect(status.status).toBe("SUSPENDED");
  });
});
