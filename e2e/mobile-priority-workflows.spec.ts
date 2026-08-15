import { expect, test, type Page, type Route } from "@playwright/test";

const syntheticDisclosure =
  "SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION";

const tracker = {
  source: "SYNTHETIC_SIMULATOR",
  freshness: "FRESH",
  recordedAt: "2026-08-12T18:00:00.000Z",
  isSynthetic: true,
  mappingState: "MAPPED",
  limitations: ["Synthetic pilot telemetry; not a live provider reading."],
};

function bootstrap(kind: "guard" | "owner") {
  const guard = kind === "guard";
  return {
    principal: {
      userId: `${kind}-user`,
      name: guard ? "Synthetic Guard" : "Synthetic Owner",
      roleName: guard ? "Security Guard" : "Owner Executive",
      tenant: { id: "tenant-a", name: "Synthetic Fleet", slug: "synthetic" },
      permissions: guard
        ? [
            "gateEvent:VIEW",
            "gateEvent:CREATE",
            "gateEvent:EDIT",
            "movement:VIEW",
            "facialVerificationAttempt:CREATE",
            "facialVerificationFallback:VIEW",
            "facialVerificationFallback:CREATE",
          ]
        : [
            "movement:VIEW",
            "movement:APPROVE",
            "governanceAnalytics:VIEW",
            "exception:VIEW",
            "facialVerificationFallback:VIEW",
            "facialVerificationFallback:APPROVE",
            "facialVerificationFallback:REJECT",
          ],
      sessionExpiresAt: "2026-08-13T18:00:00.000Z",
    },
    sites: guard
      ? [
          {
            id: "site-1",
            name: "Synthetic Depot",
            gates: [{ id: "gate-1", name: "Main Gate", direction: "BOTH" }],
          },
        ]
      : [],
    capabilities: {
      guard,
      ownerOverview: !guard,
      approvals: !guard,
      investigations: false,
      confidentialInvestigations: false,
    },
    environment: {
      appEnv: "development",
      syntheticOnly: true,
      pushEnabled: false,
      offlineMutations: false,
    },
  };
}

const movement = (status = "APPROVED") => ({
  id: "movement-1",
  referenceCode: "SYN-MOV-001",
  status,
  movementType: "DELIVERY",
  purpose: "Synthetic delivery verification",
  destination: "Synthetic customer site",
  expectedDepartureAt: "2026-08-12T19:00:00.000Z",
  expectedReturnAt: "2026-08-12T22:00:00.000Z",
  approvedCargoSummary: "Synthetic cargo only",
  vehicle: {
    id: "vehicle-1",
    registrationNumber: "SYN 016 A",
    fleetNumber: "SYN-F016",
    status: "ACTIVE",
  },
  driver: {
    id: "driver-1",
    name: "Synthetic Driver",
    employeeNumber: "SYN-D016",
    status: "ACTIVE",
  },
  site: { id: "site-1", name: "Synthetic Depot" },
  approver: null,
  approvalComments: null,
});

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
}

async function installMobileApi(
  page: Page,
  kind: "guard" | "owner",
  exceptionPath = false,
  enrolled = true,
) {
  let authenticated = false;
  let gateStatus = "INSPECTION_STARTED";
  let inspectionOutcome: string | null = null;
  let decisionCount = 0;
  let latestAttempt: Record<string, unknown> | null = null;
  let fallback: Record<string, unknown> | null = kind === "owner" ? {
    id: "fallback-1",
    gateEventId: "event-1",
    driver: { id: "driver-1", name: "Synthetic Driver", employeeNumber: "SYN-D016" },
    reason: "Synthetic provider unavailable at the gate",
    status: "PENDING",
    requestedBy: { id: "guard-user", name: "Synthetic Guard" },
    approvedBy: null,
    requestedAt: "2026-08-12T18:10:00.000Z",
    resolvedAt: null,
    selfApprovalBlocked: false,
  } : null;
  const calls: string[] = [];
  await page.route("**/api/mobile/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(`${request.method()} ${url.pathname}`);
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization,content-type,idempotency-key",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/auth/login")) {
      authenticated = true;
      await fulfill(route, { token: "synthetic-session-token", bootstrap: bootstrap(kind) });
      return;
    }
    if (!authenticated) {
      await fulfill(route, { error: "Session required.", code: "SESSION_INVALID" }, 401);
      return;
    }
    if (url.pathname.endsWith("/bootstrap")) {
      await fulfill(route, bootstrap(kind));
      return;
    }
    if (url.pathname.endsWith("/gate/queue")) {
      await fulfill(route, {
        items: [
          {
            id: "movement-1",
            referenceCode: "SYN-MOV-001",
            status: "APPROVED",
            direction: "ENTRY",
            expectedAt: "2026-08-12T19:00:00.000Z",
            vehicle: movement().vehicle,
            driver: movement().driver,
            site: movement().site,
            authorization: { allowed: true, reason: "Approved for departure checks." },
            tracker,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      return;
    }
    if (url.pathname.endsWith("/gate/events") && request.method() === "POST") {
      await fulfill(route, { gateEvent: { id: "event-1", status: gateStatus } });
      return;
    }
    if (url.pathname.endsWith("/gate/events/event-1/actions")) {
      const body = request.postDataJSON() as { action: string; scenario?: string; reason?: string; input?: { outcome?: string } };
      if (body.action === "IDENTITY_PENDING") gateStatus = "IDENTITY_PENDING";
      if (body.action === "SYNTHETIC_IDENTITY_VERIFY") {
        const mapped = body.scenario === "SUCCESS" ? "MATCH"
          : body.scenario === "NON_MATCH" ? "NO_MATCH"
            : body.scenario === "LIVENESS_FAILURE" ? "LIVENESS_FAILED"
              : body.scenario === "PROVIDER_OUTAGE" || body.scenario === "RATE_LIMITING" ? "PROVIDER_UNAVAILABLE"
                : "REVIEW_REQUIRED";
        latestAttempt = {
          id: `attempt-${body.scenario}`,
          result: enrolled ? mapped : "NOT_ENROLLED",
          livenessResult: body.scenario === "LIVENESS_FAILURE" ? "FAILED" : "NOT_REQUIRED",
          safeErrorCode: body.scenario === "RATE_LIMITING" ? "RATE_LIMITED" : body.scenario === "PROVIDER_OUTAGE" ? "OUTAGE" : null,
          attemptedAt: "2026-08-12T18:20:00.000Z",
          synthetic: true,
          disclosure: syntheticDisclosure,
          providerId: "genbridge-local-biometric-simulator",
          policyVersion: "synthetic-policy-v1",
        };
        if (enrolled && body.scenario === "SUCCESS") gateStatus = "IDENTITY_VERIFIED";
      }
      if (body.action === "REQUEST_MANUAL_FALLBACK") fallback = {
        id: "fallback-1", gateEventId: "event-1",
        driver: { id: "driver-1", name: "Synthetic Driver", employeeNumber: "SYN-D016" },
        reason: body.reason, status: "PENDING",
        requestedBy: { id: "guard-user", name: "Synthetic Guard" }, approvedBy: null,
        requestedAt: "2026-08-12T18:25:00.000Z", resolvedAt: null, selfApprovalBlocked: true,
      };
      if (body.action === "BEGIN_CHECKS") gateStatus = "VEHICLE_CHECKS_IN_PROGRESS";
      if (body.action === "RECORD_INSPECTION") {
        inspectionOutcome = body.input?.outcome ?? null;
        if (exceptionPath && inspectionOutcome === "FAIL") gateStatus = "EXCEPTION_RAISED";
      }
      if (body.action === "ESCALATE") gateStatus = "SUPERVISOR_REVIEW";
      if (body.action === "CLEAR") gateStatus = "CLEARED";
      if (body.action === "DENY") gateStatus = "DENIED";
      if (body.action === "COMPLETE") gateStatus = "COMPLETED";
      await fulfill(route, { gateEvent: { id: "event-1", status: gateStatus } });
      return;
    }
    if (url.pathname.endsWith("/gate/events/event-1")) {
      await fulfill(route, {
        gateEvent: {
          id: "event-1",
          status: gateStatus,
          direction: "ENTRY",
          decision: gateStatus === "DENIED" ? "DENY" : null,
          vehicle: movement().vehicle,
          driver: movement().driver,
          gate: { id: "gate-1", name: "Main Gate" },
          site: movement().site,
          identity: {
            disclosure: syntheticDisclosure,
            enrolment: { status: enrolled ? "ENROLLED" : "NOT_ENROLLED", version: enrolled ? 1 : null, synthetic: enrolled ? true : null },
            latestAttempt,
            attemptsRemaining: 4,
            rateLimit: { maximum: 5, windowMinutes: 5 },
            fallback,
            auditConfirmation: latestAttempt || fallback ? {
              recorded: true,
              action: latestAttempt ? "facialVerification.syntheticAttemptRecorded" : "facialVerification.manualFallback.requested",
              recordedAt: "2026-08-12T18:25:00.000Z",
            } : null,
          },
          inspectionTemplate: {
            items: [
              {
                id: "item-1",
                label: "Odometer",
                description: "Record the synthetic dashboard reading.",
                responseType: "READING",
                unit: "km",
                isRequired: true,
              },
            ],
          },
          inspectionResults: inspectionOutcome
            ? [
                {
                  inspectionItemId: "item-1",
                  outcome: inspectionOutcome,
                  readingValue: "12000",
                  comment: null,
                },
              ]
            : [],
          exceptions:
            gateStatus === "EXCEPTION_RAISED" || gateStatus === "SUPERVISOR_REVIEW"
              ? [
                  {
                    id: "exception-1",
                    description: "Synthetic safety discrepancy",
                    severity: "HIGH",
                    resolvedAt: null,
                  },
                ]
              : [],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/evidence/upload")) {
      await fulfill(route, { mediaAsset: { id: "synthetic-evidence-1" } });
      return;
    }
    if (url.pathname.endsWith("/owner/overview")) {
      await fulfill(route, {
        counts: {
          vehiclesOut: 4,
          overdue: 1,
          awaitingApproval: 1,
          openExceptions: 2,
          highRiskIndicators: 1,
        },
        tracker: { fresh: 3, stale: 1, unavailable: 1, synthetic: 5 },
        recentActivity: [],
        recentReconciliations: [
          { id: "recon-1", referenceCode: "SYN-MOV-000", status: "OPEN", createdAt: "2026-08-12T18:00:00.000Z" },
        ],
        investigationSummaries: [],
      });
      return;
    }
    if (url.pathname.endsWith("/facial-verification/fallbacks") && request.method() === "GET") {
      await fulfill(route, { fallbacks: fallback?.status === "PENDING" ? [fallback] : [] });
      return;
    }
    if (url.pathname.endsWith("/facial-verification/fallbacks/fallback-1/decision")) {
      const body = request.postDataJSON() as { decision: "APPROVED" | "DENIED" };
      fallback = { ...fallback, status: body.decision, approvedBy: { id: "owner-user", name: "Synthetic Owner" }, resolvedAt: "2026-08-12T18:30:00.000Z" };
      await fulfill(route, { fallback });
      return;
    }
    if (url.pathname.endsWith("/notifications")) {
      await fulfill(route, {
        items: [
          {
            id: "movement-approval:movement-1",
            category: "MOVEMENT_AWAITING_APPROVAL",
            severity: "WARNING",
            title: "Movement awaiting approval",
            body: "Synthetic movement SYN-MOV-001 requires an authorized decision.",
            occurredAt: "2026-08-12T18:00:00.000Z",
            read: false,
            deepLink: "/owner/movements/movement-1",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      return;
    }
    if (url.pathname.endsWith("/movements/movement-1/decision")) {
      decisionCount++;
      await fulfill(route, { movement: { id: "movement-1", status: "APPROVED" } });
      return;
    }
    if (url.pathname.endsWith("/movements/foreign-movement")) {
      await fulfill(route, { error: "Movement not found." }, 404);
      return;
    }
    if (url.pathname.endsWith("/movements/movement-1")) {
      await fulfill(route, { movement: movement(kind === "owner" ? "SUBMITTED" : "APPROVED"), tracker });
      return;
    }
    await fulfill(route, { error: "Synthetic route not configured." }, 404);
  });
  return {
    decisionCount: () => decisionCount,
    calls: () => [...calls],
  };
}

async function signIn(
  page: Page,
  kind: "guard" | "owner",
  api: Awaited<ReturnType<typeof installMobileApi>>,
) {
  await page.goto("http://127.0.0.1:4173");
  await page.getByLabel("Company").fill("synthetic");
  await page.getByLabel("Email").fill(`${kind}@example.test`);
  await page.getByLabel("Password").fill("SyntheticOnly!1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => api.calls()).toContain("POST /api/mobile/auth/login");
  await expect(page.getByText(kind === "guard" ? "Hello, Synthetic Guard" : "Hello, Synthetic Owner")).toBeVisible();
}

async function openIdentityPending(page: Page) {
  await page.getByRole("button", { name: "Open gate queue" }).click();
  await expect(page.getByRole("heading", { name: "Gate queue" })).toBeVisible();
  await page.getByRole("button", { name: "Open movement" }).click();
  await page.getByLabel("I confirmed the displayed vehicle").check();
  await page.getByLabel("I confirmed the displayed driver").check();
  await page.getByRole("button", { name: "Start departure checks" }).click();
  await expect(page.getByRole("heading", { name: "Gate event" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm identity step" }).click();
  await expect(page.getByText(syntheticDisclosure).first()).toBeVisible();
}

async function openStartedGateEvent(page: Page) {
  await openIdentityPending(page);
  await page.getByRole("button", { name: /Check camera permission/ }).click();
  await page.getByRole("button", { name: "Initiate synthetic facial-verification test" }).click();
  await expect(page.getByText("Audit confirmation")).toBeVisible();
  await page.getByRole("button", { name: "Begin vehicle checks" }).click();
  await page.getByLabel("Odometer (km)").fill("12000");
}

for (const [scenario, result] of [
  ["Non-match result", "Non-match result"],
  ["Facial-liveness failure", "Facial-liveness failure"],
  ["Indeterminate result", "Indeterminate result"],
  ["Provider-unavailable result", "Provider unavailable"],
  ["Provider rate-limit result", "Rate limit feedback"],
] as const) {
  test(`Security Guard receives explicit ${result.toLowerCase()} feedback`, async ({ page }) => {
    const api = await installMobileApi(page, "guard");
    await signIn(page, "guard", api);
    await openIdentityPending(page);
    await page.getByRole("button", { name: /Check camera permission/ }).click();
    await page.getByLabel("Test outcome").selectOption({ label: scenario });
    await page.getByRole("button", { name: "Initiate synthetic facial-verification test" }).click();
    await expect(page.getByRole("alert").filter({ hasText: result })).toBeVisible();
    await expect(page.getByText("Audit confirmation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Begin vehicle checks" })).toHaveCount(0);
  });
}

test("not-enrolled status blocks simulation and requires controlled fallback", async ({ page }) => {
  const api = await installMobileApi(page, "guard", false, false);
  await signIn(page, "guard", api);
  await openIdentityPending(page);
  await expect(page.getByLabel("Danger: NOT ENROLLED")).toBeVisible();
  await expect(page.getByRole("button", { name: "Initiate synthetic facial-verification test" })).toBeDisabled();
  const request = page.getByRole("button", { name: "Request manager approval" });
  await expect(request).toBeDisabled();
  await page.getByLabel("Mandatory fallback reason").fill("No active test enrolment is available");
  await expect(request).toBeEnabled();
  await request.click();
  await expect(page.locator(".badge", { hasText: "Fallback PENDING" })).toBeVisible();
  await expect(page.getByText(/Separation of duties is enforced/)).toBeVisible();
});

test("Security Guard completes a synthetic departure with evidence and server confirmation", async ({ page }) => {
  const api = await installMobileApi(page, "guard");
  await signIn(page, "guard", api);
  await openStartedGateEvent(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-inspection.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic-evidence"),
  });
  await page.getByRole("button", { name: "Upload evidence" }).click();
  await expect(page.getByText("Evidence uploaded")).toBeVisible();
  await page.getByRole("button", { name: "Pass" }).click();
  await expect(page.locator(".badge", { hasText: "PASS" })).toBeVisible();
  await page.getByLabel("Decision or override reason").fill("Synthetic checks complete");
  await page.getByRole("button", { name: "Clear movement" }).click();
  await page.getByRole("button", { name: "Record final gate outcome" }).click();
  await expect(page.getByText("Gate workflow complete")).toBeVisible();
  await expect(page.getByText(/server recorded the final outcome/i)).toBeVisible();
});

test("Security Guard raises, escalates, and blocks a synthetic safety exception", async ({ page }) => {
  const api = await installMobileApi(page, "guard", true);
  await signIn(page, "guard", api);
  await openStartedGateEvent(page);
  await page.getByRole("button", { name: "Fail and raise exception" }).click();
  await page.getByRole("button", { name: "Request supervisor review" }).click();
  await page.getByLabel("Decision or override reason").fill("Synthetic tyre safety discrepancy");
  await page.getByRole("button", { name: "Block movement" }).click();
  await page.getByRole("button", { name: "Record final gate outcome" }).click();
  await expect(page.getByText("Gate workflow complete")).toBeVisible();
});

test("Owner reviews summary, provenance and performs one authorized approval", async ({ page }) => {
  const api = await installMobileApi(page, "owner");
  await signIn(page, "owner", api);
  await page.getByRole("button", { name: "Open overview" }).click();
  await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
  await expect(page.getByLabel("Vehicles out: 4")).toBeVisible();
  await expect(page.getByText("Synthetic tracker data present")).toBeVisible();
  await expect(page.getByText(/not evidence of wrongdoing/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Manual identity fallback approvals" })).toBeVisible();
  await page.getByRole("button", { name: "Approve fallback" }).click();
  await expect(page.getByText(/fallback approved and audit event recorded/i)).toBeVisible();
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByRole("button", { name: "Open authorized record" }).click();
  await expect(page.getByRole("heading", { name: "Movement decision" })).toBeVisible();
  await page.getByLabel("Decision comments").fill("Synthetic evidence reviewed");
  await page.getByRole("button", { name: "Approve movement" }).click();
  await expect(page.getByText("Server recorded APPROVED.")).toBeVisible();
  expect(api.decisionCount()).toBe(1);
});

test("mobile security and responsive boundaries fail closed", async ({ page }) => {
  const api = await installMobileApi(page, "owner");
  await signIn(page, "owner", api);
  await page.evaluate(() => {
    location.hash = "#/guard/movements/foreign-movement";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await expect(page.getByText("Access denied")).toBeVisible();
  await page.getByRole("button", { name: "Return home" }).click();

  for (const size of [
    { width: 360, height: 640 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size);
    const heights = await page.getByRole("navigation", { name: "Primary navigation" }).locator("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(heights.every((height) => height >= 44)).toBe(true);
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflows).toBe(false);
  }
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("alert").filter({ hasText: "Disconnected" })).toBeVisible();
});
