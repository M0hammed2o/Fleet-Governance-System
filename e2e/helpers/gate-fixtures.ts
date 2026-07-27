import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * P9F-002 — shared helpers for building a brand-new, tenant-scoped gate
 * event dedicated to a single test via real API calls (create driver ->
 * enrol -> create/submit/approve movement -> start gate event -> drive
 * state). Replaces the earlier pattern of relying on a specific seeded
 * gate event being in a particular status (whose ordering from `GET
 * /api/gate/gate-events` was observed to vary between runs — see
 * KNOWN_BUGS.md / TODO.md's now-closed P9F-002 item). Every fixture here
 * creates new rows; nothing mutates or depends on seed data.
 */

const DEV_PASSWORD = "GateFleet!Dev1";
export const TENANT_SLUG = "acme-logistics";

export async function loginNewContext(
  browser: Browser,
  email: string,
  contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Company").fill(TENANT_SLUG);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
  return { context, page };
}

export function syntheticDescriptor(seed: number, length = 128): number[] {
  return Array.from({ length }, (_, i) => Math.sin(seed + i) * 5);
}

export interface DedicatedGateEventRoles {
  adminPage: Page;
  fleetPage: Page;
  dispatchPage: Page;
  approverPage: Page;
  officerPage: Page;
}

export interface DedicatedGateEventRolesWithContexts extends DedicatedGateEventRoles {
  contexts: BrowserContext[];
}

/** Logs in the five tenant roles a full gate-event fixture build needs. `officerContextOptions` lets a caller grant/withhold camera permission on just the officer's context. */
export async function loginAllRoles(browser: Browser, officerContextOptions?: Parameters<Browser["newContext"]>[0]): Promise<DedicatedGateEventRolesWithContexts> {
  const admin = await loginNewContext(browser, "company.administrator@example.test");
  const fleet = await loginNewContext(browser, "fleet.and.gps.manager@example.test");
  const dispatch = await loginNewContext(browser, "dispatch.and.logistics.officer@example.test");
  const approver = await loginNewContext(browser, "security.supervisor.approving.manager@example.test");
  const officer = await loginNewContext(browser, "gate.security.officer@example.test", officerContextOptions);
  return {
    adminPage: admin.page,
    fleetPage: fleet.page,
    dispatchPage: dispatch.page,
    approverPage: approver.page,
    officerPage: officer.page,
    contexts: [admin.context, fleet.context, dispatch.context, approver.context, officer.context],
  };
}

export interface DedicatedGateEvent {
  gateEventId: string;
  driverId: string;
  vehicleId: string;
  siteId: string;
  gateId: string;
  matchingDescriptor: number[];
}

/**
 * Creates one brand-new driver (enrolled with a unique synthetic biometric
 * template) + approved movement + gate event, driven to IDENTITY_PENDING —
 * a dedicated fixture, never a shared/seeded row.
 */
export async function createDedicatedGateEventAtIdentityPending(roles: DedicatedGateEventRoles, seed: number): Promise<DedicatedGateEvent> {
  const suffix = `${seed}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const createDriverRes = await roles.fleetPage.request.post("/api/drivers", { data: { name: `E2E Fixture Driver ${suffix}` } });
  expect(createDriverRes.ok()).toBe(true);
  const { driver } = await createDriverRes.json();

  const base = syntheticDescriptor(seed);
  const captures = [0, 1, 2].map((i) => base.map((v, j) => v + Math.sin(i * 3 + j) * 0.01));
  const enrolRes = await roles.adminPage.request.post(`/api/drivers/${driver.id}/facial-enrolment`, {
    data: { captureDescriptors: captures, consentAcknowledged: true },
  });
  expect(enrolRes.ok()).toBe(true);

  const sitesRes = await roles.adminPage.request.get("/api/admin/sites");
  const { sites } = await sitesRes.json();
  const gatesRes = await roles.adminPage.request.get("/api/admin/gates");
  const { gates } = await gatesRes.json();
  const vehiclesRes = await roles.adminPage.request.get("/api/vehicles");
  const { items: vehicles } = await vehiclesRes.json();
  expect(sites.length).toBeGreaterThan(0);
  expect(gates.length).toBeGreaterThan(0);
  expect(vehicles.length).toBeGreaterThan(0);
  const siteId = sites[0].id;
  const gateId = gates[0].id;
  const vehicleId = vehicles[0].id;

  const createMovementRes = await roles.dispatchPage.request.post("/api/movements", {
    data: { siteId, vehicleId, driverId: driver.id, movementType: "DELIVERY" },
  });
  expect(createMovementRes.ok()).toBe(true);
  const { movement } = await createMovementRes.json();

  const submitRes = await roles.dispatchPage.request.post(`/api/movements/${movement.id}/submit`);
  expect(submitRes.ok()).toBe(true);

  const approveRes = await roles.approverPage.request.post(`/api/movements/${movement.id}/approve`, { data: {} });
  expect(approveRes.ok()).toBe(true);

  const startRes = await roles.officerPage.request.post("/api/gate/gate-events", {
    data: { movementAuthorisationId: movement.id, gateId, direction: "ENTRY" },
  });
  expect(startRes.ok()).toBe(true);
  const { gateEvent } = await startRes.json();

  const pendingRes = await roles.officerPage.request.post(`/api/gate/gate-events/${gateEvent.id}/identity/pending`);
  expect(pendingRes.ok()).toBe(true);

  return { gateEventId: gateEvent.id as string, driverId: driver.id as string, vehicleId, siteId, gateId, matchingDescriptor: base };
}

/** Drives an IDENTITY_PENDING gate event to VEHICLE_CHECKS_IN_PROGRESS via a real MATCH attempt against the fixture's own enrolled driver. */
export async function advanceToVehicleChecksInProgress(officerPage: Page, fixture: DedicatedGateEvent): Promise<void> {
  const matchRes = await officerPage.request.post(`/api/gate/gate-events/${fixture.gateEventId}/facial-verification`, {
    data: { liveDescriptor: fixture.matchingDescriptor, livenessResult: "PASSED" },
  });
  expect(matchRes.ok()).toBe(true);
  const body = await matchRes.json();
  expect(body.attempt.result).toBe("MATCH");
  expect(body.gateEvent.status).toBe("IDENTITY_VERIFIED");

  const startChecksRes = await officerPage.request.post(`/api/gate/gate-events/${fixture.gateEventId}/vehicle-checks/start`);
  expect(startChecksRes.ok()).toBe(true);
}
