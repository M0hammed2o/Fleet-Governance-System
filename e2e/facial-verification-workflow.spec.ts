import crypto from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Phase 9I — full facial-verification workflow, driven through real browser
 * sessions for every role transition (login, enrol, create/submit/approve
 * movement, start gate event) with the actual biometric MATCH/NO_MATCH/
 * LIVENESS_FAILED/NOT_ENROLLED/PROVIDER_UNAVAILABLE outcomes exercised via
 * direct calls to the real verification API using synthetic descriptor
 * arrays — never real biometric data, never a real camera capture (a fake
 * camera device has no face to present, see facial-verification-smoke.spec.ts
 * for why; the camera/model-loading half of the pipeline is verified
 * separately there and in facial-verification-gate-smoke.spec.ts). This is
 * the "mocked verification" the task brief asks for: the server-side
 * matching/liveness/audit logic runs for real, against synthetic,
 * fictional descriptor numbers, not against any real person's face.
 */

const DEV_PASSWORD = "GateFleet!Dev1";
const TENANT_SLUG = "acme-logistics";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Company").fill(TENANT_SLUG);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
}

function syntheticDescriptor(seed: number, length = 128): number[] {
  return Array.from({ length }, (_, i) => Math.sin(seed + i) * 5);
}

async function createApprovedMovement(adminApi: APIRequestContext, approverApi: APIRequestContext, params: { siteId: string; vehicleId: string; driverId: string }) {
  const createRes = await adminApi.post("/api/movements", {
    data: { siteId: params.siteId, vehicleId: params.vehicleId, driverId: params.driverId, movementType: "DELIVERY" },
  });
  expect(createRes.ok()).toBe(true);
  const { movement } = await createRes.json();

  const submitRes = await adminApi.post(`/api/movements/${movement.id}/submit`);
  expect(submitRes.ok()).toBe(true);

  const approveRes = await approverApi.post(`/api/movements/${movement.id}/approve`, { data: {} });
  expect(approveRes.ok()).toBe(true);
  return movement.id as string;
}

async function startGateEventAtIdentityPending(officerApi: APIRequestContext, movementAuthorisationId: string, gateId: string) {
  const startRes = await officerApi.post("/api/gate/gate-events", {
    data: { movementAuthorisationId, gateId, direction: "ENTRY" },
  });
  expect(startRes.ok()).toBe(true);
  const { gateEvent } = await startRes.json();

  const pendingRes = await officerApi.post(`/api/gate/gate-events/${gateEvent.id}/identity/pending`);
  expect(pendingRes.ok()).toBe(true);
  return gateEvent.id as string;
}

test.describe("Phase 9I: full facial-verification workflow", () => {
  test("enrol, dispatch, approve, verify (match/no-match/liveness-failed/not-enrolled/provider-unavailable), manual fallback, audit, cross-tenant denial", async ({ browser }) => {
    // --- Company Administrator: enrols biometric templates (facialTemplate:CREATE) ---
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, "company.administrator@example.test");

    // --- Fleet and GPS Manager: the role that actually holds driver:CREATE
    // — creates the two fictional test drivers this spec uses ---
    const fleetContext = await browser.newContext();
    const fleetPage = await fleetContext.newPage();
    await login(fleetPage, "fleet.and.gps.manager@example.test");

    const driverName = `E2E Test Driver ${crypto.randomUUID().slice(0, 8)}`;
    const createDriverRes = await fleetPage.request.post("/api/drivers", { data: { name: driverName } });
    expect(createDriverRes.ok()).toBe(true);
    const { driver } = await createDriverRes.json();

    const enrolledDescriptors = [syntheticDescriptor(500), syntheticDescriptor(500), syntheticDescriptor(500)].map((d, i) =>
      d.map((v, j) => v + Math.sin(i * 3 + j) * 0.01),
    );
    const enrolRes = await adminPage.request.post(`/api/drivers/${driver.id}/facial-enrolment`, {
      data: { captureDescriptors: enrolledDescriptors, consentAcknowledged: true },
    });
    expect(enrolRes.ok()).toBe(true);

    // A second, never-enrolled driver for the NOT_ENROLLED case.
    const notEnrolledName = `E2E Not Enrolled ${crypto.randomUUID().slice(0, 8)}`;
    const createDriver2Res = await fleetPage.request.post("/api/drivers", { data: { name: notEnrolledName } });
    expect(createDriver2Res.ok()).toBe(true);
    const { driver: notEnrolledDriver } = await createDriver2Res.json();

    const sitesRes = await adminPage.request.get("/api/admin/sites");
    const { sites } = await sitesRes.json();
    const gatesRes = await adminPage.request.get("/api/admin/gates");
    const { gates } = await gatesRes.json();
    const vehiclesRes = await adminPage.request.get("/api/vehicles");
    const { items: vehicles } = await vehiclesRes.json();
    expect(sites.length).toBeGreaterThan(0);
    expect(gates.length).toBeGreaterThan(0);
    expect(vehicles.length).toBeGreaterThan(0);
    const siteId = sites[0].id;
    const gateId = gates[0].id;
    const vehicleId = vehicles[0].id;

    // --- Dispatch and Logistics Officer: creates and submits movements ---
    const dispatchContext = await browser.newContext();
    const dispatchPage = await dispatchContext.newPage();
    await login(dispatchPage, "dispatch.and.logistics.officer@example.test");

    // --- Security Supervisor / Approving Manager: a genuinely different user approves ---
    const approverContext = await browser.newContext();
    const approverPage = await approverContext.newPage();
    await login(approverPage, "security.supervisor.approving.manager@example.test");

    // --- Gate Security Officer: runs verification at the gate ---
    const officerContext = await browser.newContext();
    const officerPage = await officerContext.newPage();
    await login(officerPage, "gate.security.officer@example.test");

    // MATCH case
    const matchMovementId = await createApprovedMovement(dispatchPage.request, approverPage.request, { siteId, vehicleId, driverId: driver.id });
    const matchGateEventId = await startGateEventAtIdentityPending(officerPage.request, matchMovementId, gateId);
    const matchAttemptRes = await officerPage.request.post(`/api/gate/gate-events/${matchGateEventId}/facial-verification`, {
      data: { liveDescriptor: syntheticDescriptor(500, 128), livenessResult: "PASSED" },
    });
    expect(matchAttemptRes.ok()).toBe(true);
    const matchBody = await matchAttemptRes.json();
    expect(matchBody.attempt.result).toBe("MATCH");
    expect(matchBody.gateEvent.status).toBe("IDENTITY_VERIFIED");

    // NO_MATCH case
    const noMatchMovementId = await createApprovedMovement(dispatchPage.request, approverPage.request, { siteId, vehicleId, driverId: driver.id });
    const noMatchGateEventId = await startGateEventAtIdentityPending(officerPage.request, noMatchMovementId, gateId);
    const noMatchAttemptRes = await officerPage.request.post(`/api/gate/gate-events/${noMatchGateEventId}/facial-verification`, {
      data: { liveDescriptor: syntheticDescriptor(9999, 128), livenessResult: "PASSED" },
    });
    expect(noMatchAttemptRes.ok()).toBe(true);
    const noMatchBody = await noMatchAttemptRes.json();
    expect(noMatchBody.attempt.result).toBe("NO_MATCH");
    expect(noMatchBody.gateEvent).toBeNull();

    // LIVENESS_FAILED case
    const livenessMovementId = await createApprovedMovement(dispatchPage.request, approverPage.request, { siteId, vehicleId, driverId: driver.id });
    const livenessGateEventId = await startGateEventAtIdentityPending(officerPage.request, livenessMovementId, gateId);
    const livenessAttemptRes = await officerPage.request.post(`/api/gate/gate-events/${livenessGateEventId}/facial-verification`, {
      data: { liveDescriptor: syntheticDescriptor(500, 128), livenessResult: "FAILED" },
    });
    expect(livenessAttemptRes.ok()).toBe(true);
    const livenessBody = await livenessAttemptRes.json();
    expect(livenessBody.attempt.result).toBe("LIVENESS_FAILED");

    // NOT_ENROLLED case
    const notEnrolledMovementId = await createApprovedMovement(dispatchPage.request, approverPage.request, { siteId, vehicleId, driverId: notEnrolledDriver.id });
    const notEnrolledGateEventId = await startGateEventAtIdentityPending(officerPage.request, notEnrolledMovementId, gateId);
    const notEnrolledAttemptRes = await officerPage.request.post(`/api/gate/gate-events/${notEnrolledGateEventId}/facial-verification`, {
      data: { liveDescriptor: syntheticDescriptor(1, 128), livenessResult: "PASSED" },
    });
    expect(notEnrolledAttemptRes.ok()).toBe(true);
    const notEnrolledBody = await notEnrolledAttemptRes.json();
    expect(notEnrolledBody.attempt.result).toBe("NOT_ENROLLED");

    // PROVIDER_UNAVAILABLE case
    const providerMovementId = await createApprovedMovement(dispatchPage.request, approverPage.request, { siteId, vehicleId, driverId: driver.id });
    const providerGateEventId = await startGateEventAtIdentityPending(officerPage.request, providerMovementId, gateId);
    const providerAttemptRes = await officerPage.request.post(`/api/gate/gate-events/${providerGateEventId}/facial-verification`, {
      data: { providerUnavailable: true },
    });
    expect(providerAttemptRes.ok()).toBe(true);
    const providerBody = await providerAttemptRes.json();
    expect(providerBody.attempt.result).toBe("PROVIDER_UNAVAILABLE");

    // --- Manual fallback completes the NOT_ENROLLED gate event ---
    const fallbackRequestRes = await officerPage.request.post(`/api/drivers/${notEnrolledDriver.id}/facial-verification/manual-fallback`, {
      data: {
        reason: "Driver not yet enrolled — manual verification by officer",
        relatedGateEventId: notEnrolledGateEventId,
      },
    });
    expect(fallbackRequestRes.ok()).toBe(true);
    const { fallback } = await fallbackRequestRes.json();

    // The requester (Gate Security Officer) cannot resolve their own request — a different role must.
    const selfResolveRes = await officerPage.request.post(`/api/facial-verification/manual-fallback/${fallback.id}/resolve`, {
      data: { decision: "APPROVED" },
    });
    expect(selfResolveRes.ok()).toBe(false);

    const resolveRes = await approverPage.request.post(`/api/facial-verification/manual-fallback/${fallback.id}/resolve`, {
      data: { decision: "APPROVED" },
    });
    expect(resolveRes.ok()).toBe(true);

    const confirmManualRes = await officerPage.request.post(`/api/gate/gate-events/${notEnrolledGateEventId}/identity/manual-verified`, {
      data: { manualFallbackId: fallback.id },
    });
    expect(confirmManualRes.ok()).toBe(true);
    const confirmManualBody = await confirmManualRes.json();
    expect(confirmManualBody.gateEvent.status).toBe("IDENTITY_VERIFIED");

    // --- Audit records exist for every attempt, viewable by both the officer who ran it and Company Administrator's oversight-only grant ---
    const officerAuditRes = await officerPage.request.get(`/api/gate/gate-events/${matchGateEventId}/facial-verification`);
    expect(officerAuditRes.ok()).toBe(true);
    const { attempts } = await officerAuditRes.json();
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0].result).toBe("MATCH");

    const adminAuditRes = await adminPage.request.get(`/api/gate/gate-events/${matchGateEventId}/facial-verification`);
    expect(adminAuditRes.ok()).toBe(true);

    // Dispatch and Logistics Officer holds neither facialVerificationAttempt permission at all — confirms the permission boundary is real, not just conventionally unused.
    const dispatchAuditRes = await dispatchPage.request.get(`/api/gate/gate-events/${matchGateEventId}/facial-verification`);
    expect(dispatchAuditRes.ok()).toBe(false);

    // --- Cross-tenant denial: the platform tenant's own admin cannot see this tenant's enrolment ---
    const platformContext = await browser.newContext();
    const platformPage = await platformContext.newPage();
    await platformPage.goto("/login");
    await platformPage.getByLabel("Company").fill("platform");
    await platformPage.getByLabel("Email").fill("platform.admin@example.test");
    await platformPage.getByLabel("Password").fill(DEV_PASSWORD);
    await platformPage.getByRole("button", { name: /sign in/i }).click();
    await platformPage.waitForURL("**/dashboard");

    const crossTenantEnrolmentRes = await platformPage.request.get(`/api/drivers/${driver.id}/facial-enrolment`);
    expect(crossTenantEnrolmentRes.ok()).toBe(false);

    await adminContext.close();
    await fleetContext.close();
    await dispatchContext.close();
    await approverContext.close();
    await officerContext.close();
    await platformContext.close();
  });
});
