import crypto from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loginPilotContext } from "./helpers/billing-fixtures";

const ADMIN = "administrator@pilot.example.test";

test("Phase 18A self-service registration creates and resumes an isolated onboarding workspace", async ({ browser }) => {
  const suffix = crypto.randomUUID().slice(0, 8); const slug = `phase18a-${suffix}`; const email = `admin.${suffix}@example.test`; const password = crypto.randomBytes(24).toString("base64url") + "aA1!";
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage();
  await page.goto("/register"); await expect(page.getByRole("heading", { name: "Create demonstration account" })).toBeVisible();
  await page.getByLabel("Company name").fill(`Synthetic Phase 18A ${suffix}`); await page.getByLabel("Workspace code").fill(slug); await page.getByLabel("Industry").fill("Synthetic logistics");
  await page.getByLabel("Full name").fill("Synthetic First Administrator"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
  await page.getByLabel(/I accept the demonstration terms/).check(); await page.getByLabel(/I will use synthetic data only/).check(); await page.getByRole("button", { name: "Create demo workspace" }).click();
  await page.waitForURL("**/onboarding"); await expect(page.getByRole("heading", { name: "Set up your company" })).toBeVisible();
  const summaryResponse = await page.request.get("/api/onboarding"); expect(summaryResponse.ok()).toBe(true); const summary = await summaryResponse.json(); expect(summary).toMatchObject({ tenant: { demoWorkspace: true }, onboarding: { currentStep: 1 }, counts: { loadedVehicles: 0 } });
  const duplicate = await page.request.post("/api/demo/register", { data: { companyName: "Another synthetic company", workspaceSlug: `${slug}-duplicate`, administratorName: "Another Admin", email, password, acceptDemoTerms: true, acceptSyntheticDisclosure: true } });
  expect(duplicate.status()).toBe(400); const duplicateBody = await duplicate.json(); expect(duplicateBody.error).toBe("The demonstration workspace could not be created. Check the details or use different account information."); expect(JSON.stringify(duplicateBody)).not.toContain(email);
  await page.request.post("/api/auth/logout"); await page.goto("/login"); await page.getByLabel("Company").fill(slug); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/onboarding"); await expect(page.getByText("Progress is saved after every completed section")).toBeVisible(); await expectResponsiveAndNamed(page);
  await context.close();
});

async function expectResponsiveAndNamed(page: Page) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 8).map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })),
    unnamed: [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")].filter((element) => {
      if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") return false;
      const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : "";
      return ![element.getAttribute("aria-label"), element.getAttribute("placeholder"), label, element.textContent].some((value) => value?.trim());
    }).length,
  }));
  expect(result.overflow, JSON.stringify(result.offenders)).toBeLessThanOrEqual(1); expect(result.unnamed).toBe(0);
}

test("Phase 18A seeded dashboard, onboarding and drill-down remain demonstration ready", async ({ browser }) => {
  const { context, page } = await loginPilotContext(browser, ADMIN);
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport); await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Genbridge Synthetic Fleet Pilot" })).toBeVisible();
    await expect(page.getByText("Controlled synthetic demonstration.")).toBeVisible();
    await expect(page.locator("p:visible, span:visible").filter({ hasText: /Good standing|Review required|Serious attention required/ }).first()).toBeVisible();
    await expectResponsiveAndNamed(page);
  }

  await page.goto("/onboarding"); await expect(page.getByRole("heading", { name: "Set up your company" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review/ })).toBeVisible();
  const onboarding = await page.request.get("/api/onboarding"); expect(onboarding.ok()).toBe(true); expect((await onboarding.json()).counts).toMatchObject({ declaredFleetSize: 18, loadedVehicles: 15, outstandingVehicles: 3 });
  await page.getByRole("button", { name: /Review/ }).click();
  await expect(page.getByText("SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION")).toBeVisible();

  await page.goto("/admin/assignments"); await expect(page.getByRole("heading", { name: /Driver.*vehicle assignments/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Assignment history" }).locator("article")).toHaveCount(12);

  await page.goto("/admin/drivers/pilot-driver-1"); await expect(page.getByRole("heading", { name: "Synthetic Driver 01", exact: true })).toBeVisible();
  await expect(page.getByText("Good standing", { exact: false })).toBeVisible(); await expect(page.getByText(/rule phase18a-driver-governance-v1/i)).toBeVisible();

  const missingDriverResponse = await page.goto("/admin/drivers/synthetic-driver-that-does-not-exist");
  expect(missingDriverResponse?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Driver not found" })).toBeVisible();

  await page.goto("/admin/vehicles/pilot-vehicle-1"); await expect(page.getByRole("heading", { name: "SYN001GP", exact: true })).toBeVisible();
  await expect(page.getByText("8 tonnes", { exact: true })).toBeVisible(); await expect(page.getByText("DEMONSTRATION TRACKING — SYNTHETIC OR MANUALLY ENTERED; NOT A LIVE PROVIDER FEED")).toBeVisible();

  await page.goto("/admin/users"); await expect(page.getByRole("heading", { name: "Staff and security guards" })).toBeVisible();
  await expect(page.getByText("Synthetic Pending Security Guard", { exact: true })).toBeVisible(); await expect(page.getByText("Approval pending", { exact: true })).toBeVisible();
  await context.close();
});
