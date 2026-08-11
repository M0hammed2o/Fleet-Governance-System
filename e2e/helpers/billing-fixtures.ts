import crypto from "node:crypto";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Phase 10 (P10O) — shared helpers for the billing/subscriptions Playwright
 * coverage. Reuses the seeded "acme-logistics" tenant's fixed-identity
 * users (deterministic, fixed email addresses — not the seed-data-ordering
 * anti-pattern P9F-002 removed elsewhere, which was about relying on
 * *which* row a list query happened to return first) and creates its own
 * dedicated second tenant via the real platform-tenant-creation API for
 * cross-tenant isolation checks, never raw SQL.
 */

const DEV_PASSWORD = "GateFleet!Dev1";
export const CUSTOMER_TENANT_SLUG = "acme-logistics";
export const PLATFORM_TENANT_SLUG = "platform";

export async function loginNewContext(
  browser: Browser,
  tenantSlug: string,
  email: string,
  contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("Company").fill(tenantSlug);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(DEV_PASSWORD);
    await expect(page.getByLabel("Company")).toHaveValue(tenantSlug);
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await page.getByRole("button", { name: /sign in/i }).click();
    try {
      await page.waitForURL("**/dashboard", { timeout: 45_000 });
      return { context, page };
    } catch (error) {
      if (attempt === 1) throw error;
      // A cold Next dev server can rebuild/reload the login route between
      // fill and submit. Retry once with fresh fields instead of consuming
      // the entire 180-second workflow timeout on an empty login page.
    }
  }
  throw new Error("Unable to complete the test login flow.");
}

/** Creates a brand-new, empty second tenant (no roles/users) via the real platform-tenant API — enough to prove an invoice/tenant-scoped resource never leaks across a tenant boundary, without needing a second fully-onboarded customer. */
export async function createDedicatedSecondTenant(platformAdminPage: Page): Promise<{ id: string; slug: string }> {
  const slug = `e2e-billing-isolation-${crypto.randomUUID().slice(0, 8)}`;
  const res = await platformAdminPage.request.post("/api/platform/tenants", { data: { name: `E2E Billing Isolation ${slug}`, slug } });
  expect(res.ok()).toBe(true);
  const { tenant } = await res.json();
  return tenant;
}
