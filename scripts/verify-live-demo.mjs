/**
 * Credential-safe browser rehearsal for the fixed synthetic customer demo.
 * It reads the ignored credential file in-process, never logs its contents,
 * performs no mutations beyond normal login/session creation, and writes only
 * route/status evidence without screenshots or response bodies.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.LIVE_DEMO_BASE_URL || "https://genbridge-fleet-governance.onrender.com").replace(/\/$/, "");
const runId = process.env.LIVE_DEMO_RUN_ID || "manual";
const credentialPath = path.resolve(process.env.LIVE_DEMO_CREDENTIAL_FILE || ".data/private/demo-login-details.txt");
const evidencePath = path.resolve(".data", `live-demo-rehearsal-${runId}.json`);
const forbiddenPageText = /Internal server error|Application error|unhandled exception/i;
const foreignTenantText = /Acme Logistics|Genbridge Synthetic Fleet Pilot/i;

const driverNames = [
  "Demo Driver — Thabo Nkosi", "Demo Driver — Naledi Dube", "Demo Driver — Kagiso Molefe", "Demo Driver — Zanele Ngcobo",
  "Demo Driver — Bongani Mahlangu", "Demo Driver — Precious Khoza", "Demo Driver — Sibusiso Zwane", "Demo Driver — Andile Cele",
  "Demo Driver — Refilwe Sithole", "Demo Driver — Karabo Sekhukhune",
];
const vehicleFleetNumbers = [
  "DEMO-TRK-001", "DEMO-TRK-002", "DEMO-TRK-003", "DEMO-DEL-001", "DEMO-DEL-002", "DEMO-BAKKIE-001",
  "DEMO-BAKKIE-002", "DEMO-VAN-001", "DEMO-SALES-001", "DEMO-SALES-002", "DEMO-POOL-001", "DEMO-TRAILER-001",
];
const accounts = [
  ["Company Administrator", "demo.admin@genbridge.co.za"],
  ["Dispatch and Logistics Officer", "demo.dispatch@genbridge.co.za"],
  ["Gate Security Officer", "demo.guard@genbridge.co.za"],
  ["Security Supervisor / Approving Manager", "demo.manager@genbridge.co.za"],
  ["Fleet and GPS Manager", "demo.fleet@genbridge.co.za"],
  ["Executive Read-Only Viewer", "demo.executive@genbridge.co.za"],
];

function requireCredential() {
  const text = fs.readFileSync(credentialPath, "utf8");
  const password = text.match(/^Password:\s*(.+)$/m)?.[1]?.trim();
  if (!password || password.length < 20) throw new Error("The ignored live-demo credential file is missing a valid temporary password.");
  return password;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(browser, email, password) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`);
  });
  const response = await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  assert(response?.status() === 200, `Login page returned ${response?.status() ?? "no response"}.`);
  await page.getByLabel("Company").fill("genbridge-demo-logistics");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  // The app's post-login redirect is a client-side router.push with no
  // browser navigation event Playwright's waitForURL can reliably observe
  // (dev-mode Fast Refresh can also race Playwright's navigation-lifecycle
  // detection). Poll the live DOM location instead.
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForFunction(() => !window.location.pathname.includes("/login"), null, { timeout: 180_000 });
  assert(!page.url().includes("/onboarding"), `${email} was incorrectly forced into onboarding.`);
  return { context, page, runtimeErrors };
}

async function inspectPage(page, runtimeErrors, route, expectedText, evidence) {
  const errorOffset = runtimeErrors.length;
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  assert(response, `${route} produced no navigation response.`);
  assert(response.status() === 200, `${route} returned HTTP ${response.status()}.`);
  await page.getByText(expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: 180_000 });
  const body = (await page.locator("body").innerText()).trim();
  assert(body.length > 80, `${route} rendered an empty or incomplete page.`);
  assert(!forbiddenPageText.test(body), `${route} rendered a server/application error.`);
  assert(!foreignTenantText.test(body), `${route} displayed a foreign tenant fixture.`);
  const newErrors = runtimeErrors.slice(errorOffset).filter((entry) => entry.startsWith("pageerror:") || forbiddenPageText.test(entry));
  assert(newErrors.length === 0, `${route} emitted an application runtime error.`);
  const brokenImages = await page.locator("img:visible").evaluateAll((images) => images.filter((image) => image.complete && image.naturalWidth === 0).length);
  assert(brokenImages === 0, `${route} displayed ${brokenImages} broken image(s).`);
  evidence.routes.push({ route, status: response.status(), expectedText: String(expectedText), brokenImages });
  return body;
}

async function main() {
  assert(/^https:\/\//.test(baseUrl) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl), "Live demo URL must be HTTPS or an explicit loopback URL.");
  const password = requireCredential();
  const evidence = { runId, baseUrl, startedAt: new Date().toISOString(), status: "FAIL", roles: [], routes: [], isolation: {}, runtimeErrorCount: 0 };
  const browser = await chromium.launch();
  try {
    const admin = await login(browser, accounts[0][1], password);
    evidence.roles.push(accounts[0][0]);
    await inspectPage(admin.page, admin.runtimeErrors, "/dashboard", "Genbridge Demonstration Logistics", evidence);
    const dashboardText = await admin.page.locator("body").innerText();
    assert(dashboardText.includes("Controlled synthetic demonstration"), "Dashboard synthetic-data warning is missing.");
    assert(dashboardText.includes("12 / 15"), "Dashboard does not show the expected loaded/declared fleet count.");

    await inspectPage(admin.page, admin.runtimeErrors, "/onboarding", "Create local invitation", evidence);
    await admin.page.getByRole("button", { name: "Fleet plan" }).click();
    await admin.page.getByText(/12 vehicles loaded/).waitFor({ state: "visible", timeout: 180_000 });
    const onboardingText = await admin.page.locator("body").innerText();
    assert(onboardingText.includes("15") && onboardingText.includes("12") && onboardingText.includes("3"), "Onboarding does not show the 15/12/3 fleet reconciliation.");
    await inspectPage(admin.page, admin.runtimeErrors, "/admin/drivers", "Drivers", evidence);
    for (let index = 0; index < driverNames.length; index += 1) {
      const body = await inspectPage(admin.page, admin.runtimeErrors, `/admin/drivers/live-demo-driver-${index + 1}`, driverNames[index], evidence);
      assert(body.includes("Operational governance rating"), `Driver ${index + 1} lacks the complete rating panel.`);
      assert(body.includes("Vehicle assignment history"), `Driver ${index + 1} lacks assignment history.`);
    }
    const green = await inspectPage(admin.page, admin.runtimeErrors, "/admin/drivers/live-demo-driver-1", "Good standing", evidence);
    assert(green.includes("SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION"), "Exact synthetic biometric warning is missing from the enrolled driver.");
    const yellow = await inspectPage(admin.page, admin.runtimeErrors, "/admin/drivers/live-demo-driver-6", "Review required", evidence);
    assert(/professional permit|employee number|contact/i.test(yellow), "Yellow driver lacks explainable review factors.");
    const red = await inspectPage(admin.page, admin.runtimeErrors, "/admin/drivers/live-demo-driver-8", "Serious attention", evidence);
    assert(/expired/i.test(red) && /Action:/i.test(red), "Red driver lacks expired-document factors and corrective action.");
    const pendingFallback = await inspectPage(admin.page, admin.runtimeErrors, "/admin/drivers/live-demo-driver-2", "Synthetic camera unavailable", evidence);
    assert(pendingFallback.includes("PENDING"), "Pending manual fallback is not visible.");
    const approvedFallback = await inspectPage(admin.page, admin.runtimeErrors, "/admin/drivers/live-demo-driver-3", "independent approval required", evidence);
    assert(approvedFallback.includes("APPROVED"), "Approved independently-reviewed fallback is not visible.");

    await inspectPage(admin.page, admin.runtimeErrors, "/admin/vehicles", "Vehicles", evidence);
    for (let index = 0; index < vehicleFleetNumbers.length; index += 1) {
      const registration = `${vehicleFleetNumbers[index]}-GP`;
      const body = await inspectPage(admin.page, admin.runtimeErrors, `/admin/vehicles/live-demo-vehicle-${index + 1}`, registration, evidence);
      assert(body.includes("Assignment history") && body.includes("Tracker provenance"), `Vehicle ${index + 1} lacks complete drill-down panels.`);
    }
    const truck = await inspectPage(admin.page, admin.runtimeErrors, "/admin/vehicles/live-demo-vehicle-3", "20 tonnes", evidence);
    assert(truck.includes("DEMONSTRATION TRACKING — SYNTHETIC OR MANUALLY ENTERED; NOT A LIVE PROVIDER FEED"), "Vehicle tracker disclosure is missing.");
    const salesVehicle = await inspectPage(admin.page, admin.runtimeErrors, "/admin/vehicles/live-demo-vehicle-10", "SALES REPRESENTATIVE", evidence);
    assert(salesVehicle.includes("Sales") && salesVehicle.includes("Unassigned"), "Sales-representative vehicle details are incomplete.");

    await inspectPage(admin.page, admin.runtimeErrors, "/admin/assignments", "Driver–vehicle assignments", evidence);
    await inspectPage(admin.page, admin.runtimeErrors, "/admin/users", "Staff and security guards", evidence);
    // The heading renders immediately; the staff list itself loads via a
    // separate client-side fetch after mount, so wait for it explicitly.
    await admin.page.getByRole("heading", { name: "Demo Pending Gate Security Officer" }).waitFor({ state: "visible", timeout: 180_000 });
    const staffText = await admin.page.locator("body").innerText();
    assert(staffText.includes("Demo Gate Security Officer") && staffText.includes("Demo Pending Gate Security Officer") && staffText.includes("Approval pending"), "Approved/pending guard records are incomplete.");
    await inspectPage(admin.page, admin.runtimeErrors, "/admin/organisation", "Sites & gates", evidence);
    await inspectPage(admin.page, admin.runtimeErrors, "/admin/movements", "Movement authorisations", evidence);
    await inspectPage(admin.page, admin.runtimeErrors, "/admin/movements/live-demo-movement-normal", "DEMOMOV001", evidence);
    await inspectPage(admin.page, admin.runtimeErrors, "/admin/reconciliations/live-demo-reconciliation-odometer", "DEMOMOV004", evidence);
    await inspectPage(admin.page, admin.runtimeErrors, "/gate/events/live-demo-gate-event-normal-out", "DEMO-TRK-001-GP", evidence);
    const returnEvent = await inspectPage(admin.page, admin.runtimeErrors, "/gate/events/live-demo-gate-event-exception-in", "DEMO-TRK-003-GP", evidence);
    assert(/inspection|exception/i.test(returnEvent), "Return event lacks inspection/exception evidence.");

    const foreignDriver = await admin.page.request.get(`${baseUrl}/api/drivers/acme-driver-1`);
    const platformTenants = await admin.page.request.get(`${baseUrl}/api/platform/tenants`);
    evidence.isolation = { foreignDriverStatus: foreignDriver.status(), platformTenantStatus: platformTenants.status() };
    assert(foreignDriver.status() === 404, "A foreign driver identifier did not fail tenant-scoped as 404.");
    assert(platformTenants.status() === 403, "The demo administrator unexpectedly reached platform tenant data.");
    assert(!admin.runtimeErrors.some((entry) => entry.startsWith("pageerror:")), "Administrator rehearsal emitted a browser page error.");
    evidence.runtimeErrorCount += admin.runtimeErrors.length;
    await admin.context.close();

    for (const [role, email] of accounts.slice(1)) {
      const session = await login(browser, email, password);
      evidence.roles.push(role);
      const expected = role === "Gate Security Officer" ? "Find approved movement" : role === "Executive Read-Only Viewer" ? "Genbridge Demonstration Logistics" : role;
      if (role === "Gate Security Officer") await inspectPage(session.page, session.runtimeErrors, "/gate", expected, evidence);
      else if (role === "Executive Read-Only Viewer") await inspectPage(session.page, session.runtimeErrors, "/dashboard", expected, evidence);
      else {
        await session.page.getByText(role, { exact: true }).first().waitFor({ state: "visible", timeout: 180_000 });
        const body = (await session.page.locator("body").innerText()).trim();
        assert(body.length > 80 && !forbiddenPageText.test(body), `${role} landing page is broken.`);
      }
      assert(!session.runtimeErrors.some((entry) => entry.startsWith("pageerror:")), `${role} emitted a browser page error.`);
      evidence.runtimeErrorCount += session.runtimeErrors.length;
      await session.context.close();
    }

    assert(evidence.roles.length === accounts.length, "Not every required demo role authenticated.");
    evidence.status = "PASS";
    evidence.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ status: evidence.status, runId, baseUrl, rolesVerified: evidence.roles.length, routesVerified: evidence.routes.length, isolation: evidence.isolation, runtimeErrorCount: evidence.runtimeErrorCount, evidencePath }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[live-demo:${runId}] FAIL: ${error instanceof Error ? error.message : "Unknown verification failure."}`);
  process.exit(1);
});
