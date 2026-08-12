import { expect, test, type Page } from "@playwright/test";
import { loginNewContext, loginPilotContext } from "./helpers/billing-fixtures";

const ADMIN = "administrator@pilot.example.test";
const OFFICER = "security.officer@pilot.example.test";
const MANAGER = "approving.manager@pilot.example.test";
const AUDITOR = "external.auditor@pilot.example.test";

async function expectAccessibleViewport(page: Page) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const unnamed = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")]
      .filter((element) => {
        if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") return false;
        const id = element.id;
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
        return ![
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("placeholder"),
          label,
          element.textContent,
        ].some((value) => value?.trim());
      })
      .map((element) => element.outerHTML.slice(0, 160));
    const undersized = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24);
      })
      .map((element) => element.outerHTML.slice(0, 160));
    return {
      headings: document.querySelectorAll("h1").length,
      overflow: root.scrollWidth - root.clientWidth,
      unnamed,
      undersized,
    };
  });
  expect(result.headings).toBe(1);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.unnamed).toEqual([]);
  expect(result.undersized).toEqual([]);
}

test("synthetic pilot records, permissions, and tenant boundaries are coherent", async ({ browser }) => {
  const { context: adminContext, page: adminPage } = await loginPilotContext(browser, ADMIN);
  const [vehiclesResponse, driversResponse, movementsResponse, eventsResponse, casesResponse] = await Promise.all([
    adminPage.request.get("/api/vehicles?pageSize=25"),
    adminPage.request.get("/api/drivers?pageSize=25"),
    adminPage.request.get("/api/movements"),
    adminPage.request.get("/api/gate/gate-events"),
    adminPage.request.get("/api/investigations"),
  ]);
  for (const response of [vehiclesResponse, driversResponse, movementsResponse, eventsResponse, casesResponse]) expect(response.ok()).toBe(true);
  const vehicles = await vehiclesResponse.json();
  const drivers = await driversResponse.json();
  const movements = await movementsResponse.json();
  const events = await eventsResponse.json();
  const cases = await casesResponse.json();
  expect(vehicles.total).toBe(15);
  expect(drivers.total).toBe(15);
  expect(movements.total).toBe(9);
  expect(events.total).toBe(14);
  expect(cases.cases).toHaveLength(2);
  expect(JSON.stringify({ vehicles, drivers, movements, events, cases })).toContain("Synthetic");

  const { context: officerContext, page: officerPage } = await loginPilotContext(browser, OFFICER);
  const forbiddenCreate = await officerPage.request.post("/api/vehicles", { data: { registrationNumber: "SYN-FORBIDDEN" } });
  expect(forbiddenCreate.status()).toBe(403);
  const forbiddenMapping = await officerPage.request.post("/api/vehicles/pilot-vehicle-14/tracker-mappings", { data: { providerId: "synthetic", providerAssetId: "SYNTHETIC-FORBIDDEN", source: "SYNTHETIC", effectiveFrom: "2030-01-01T00:00:00.000Z", reason: "Unauthorized mapping attempt must be rejected." } });
  expect(forbiddenMapping.status()).toBe(403);
  const mappingHistory = await adminPage.request.get("/api/vehicles/pilot-vehicle-1/tracker-mappings");
  expect(mappingHistory.ok()).toBe(true);
  const mappingBody = await mappingHistory.json();
  expect(mappingBody.mappings).toHaveLength(1);
  expect(mappingBody.mappings[0]).toMatchObject({ source: "SYNTHETIC", providerAssetFingerprint: expect.any(String) });
  expect(JSON.stringify(mappingBody)).not.toContain("SYN-TRACK-1");

  const { context: acmeContext, page: acmePage } = await loginNewContext(browser, "acme-logistics", "company.administrator@example.test");
  const foreignList = await acmePage.request.get("/api/vehicles?pageSize=1");
  expect(foreignList.ok()).toBe(true);
  const foreignVehicleId = (await foreignList.json()).items[0].id as string;
  const foreignRead = await adminPage.request.get(`/api/vehicles/${foreignVehicleId}`);
  expect([403, 404]).toContain(foreignRead.status());
  expect(await foreignRead.text()).not.toMatch(/registrationNumber|fleetNumber|vin/i);

  const { context: auditorContext, page: auditorPage } = await loginPilotContext(browser, AUDITOR);
  const auditorCases = await auditorPage.request.get("/api/external-auditor/cases");
  expect(auditorCases.ok()).toBe(true);
  const visibleCases = (await auditorCases.json()).cases as Array<{ id: string }>;
  expect(visibleCases.map(({ id }) => id)).toEqual(["pilot-case-closed"]);
  const unrelated = await auditorPage.request.get("/api/external-auditor/cases/pilot-case-unrelated");
  expect([403, 404]).toContain(unrelated.status());

  await Promise.all([adminContext.close(), officerContext.close(), acmeContext.close(), auditorContext.close()]);
});

test("critical pilot pages remain named and overflow-free at gate viewports", async ({ browser }) => {
  const { context: officerContext, page: officerPage } = await loginPilotContext(browser, OFFICER);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await officerPage.setViewportSize(viewport);
    await officerPage.goto("/gate");
    await expect(officerPage.getByRole("heading", { name: "Find approved movement" })).toBeVisible();
    await expect(officerPage.getByLabel("Movement search")).toBeFocused();
    await officerPage.keyboard.press("Tab");
    await expect(officerPage.getByRole("button", { name: "Search" })).toBeFocused();
    await expectAccessibleViewport(officerPage);
    await officerPage.getByLabel("Movement search").fill("SYNPILOT007");
    await officerPage.getByRole("button", { name: "Search" }).click();
    await expect(officerPage.getByText("SYNPILOT007", { exact: true })).toBeVisible();
    await expectAccessibleViewport(officerPage);
  }

  const { context: managerContext, page: managerPage } = await loginPilotContext(browser, MANAGER, { viewport: { width: 390, height: 844 } });
  for (const path of ["/analytics", "/investigations"]) {
    await managerPage.goto(path);
    await expect(managerPage.locator("h1")).toBeVisible();
    await expectAccessibleViewport(managerPage);
  }
  await Promise.all([officerContext.close(), managerContext.close()]);
});

test("vehicle detail clearly distinguishes synthetic tracker mapping and provenance", async ({ browser }) => {
  const { context, page } = await loginPilotContext(browser, ADMIN, { viewport: { width: 390, height: 844 } });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin/vehicles/pilot-vehicle-1");
    await expect(page.getByRole("heading", { name: "SYN001GP" })).toBeVisible();
    await expect(page.getByText("Synthetic — not live", { exact: true })).toBeVisible();
    await expect(page.getByText("SYNTHETIC MAPPING — NOT LIVE", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Generated test data; not observed from a real vehicle.");
    await expectAccessibleViewport(page);
  }

  await page.goto("/admin/vehicles/pilot-vehicle-14");
  await expect(page.getByText("Tracker data unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("UNMAPPED", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Missing tracker data is not proof of misconduct.");
  await context.close();
});

test("online-only gate boundary shows failure and recovers from authoritative state", async ({ browser }) => {
  const { context, page } = await loginPilotContext(browser, OFFICER, { viewport: { width: 390, height: 844 } });
  await page.goto("/gate");
  await context.setOffline(true);
  await page.getByLabel("Movement search").fill("SYNPILOT007");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/failed|network|fetch/i);
  await expect(page.getByText("SYNPILOT007", { exact: true })).toHaveCount(0);
  await context.setOffline(false);
  await page.reload();
  await page.getByLabel("Movement search").fill("SYNPILOT007");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("SYNPILOT007", { exact: true })).toBeVisible();
  await context.close();
});
