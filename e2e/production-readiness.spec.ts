import { expect, test } from "@playwright/test";
import { loginNewContext } from "./helpers/billing-fixtures";

test("platform administrator can inspect degraded readiness without triggering an external action", async ({ browser }) => {
  const { context, page } = await loginNewContext(browser, "platform", "platform.admin@example.test");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/platform/readiness");
  await expect(page.getByRole("heading", { name: "Production readiness" })).toBeVisible();
  await expect(page.getByText("NOT READY", { exact: true })).toBeVisible();
  await expect(page.getByText("Scheduled-job health")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tenant status" })).toBeVisible();
  await expect(page.getByText(/Read-only configuration and dependency diagnostics/)).toBeVisible();
  await context.close();
});

test("ordinary tenant user is denied detailed diagnostics", async ({ browser }) => {
  const { context, page } = await loginNewContext(browser, "acme-logistics", "gate.security.officer@example.test");
  const response = await page.request.get("/api/platform/diagnostics");
  expect(response.status()).toBe(403);
  expect(JSON.stringify(await response.json())).not.toMatch(/DATABASE_URL|SESSION_SECRET|tenantCount|stack/i);
  await context.close();
});
