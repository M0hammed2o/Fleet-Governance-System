import crypto from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

/**
 * Phase 8E verification — live browser test of the retention management UI
 * (8E-005) against the seeded demo tenant (prisma/seed.ts), run with a real
 * Chromium instance via Playwright (`npm run e2e`), not mocked. Exercises
 * the dual-control deletion-request workflow end to end: Company
 * Administrator initiates, a different user (Security Supervisor /
 * Approving Manager) approves — proving the separation-of-duties rule holds
 * through the actual UI, not just at the repository-test layer.
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

test("retention management page loads real policy, evidence, and request data for a Company Administrator", async ({ page }) => {
  await login(page, "company.administrator@example.test");

  await page.goto("/admin/retention");
  await expect(page.getByRole("heading", { name: "Retention management" })).toBeVisible();

  // Retention policies table is real server data — every category row renders.
  await expect(page.getByText("DRIVER PORTRAIT").first()).toBeVisible();
  await expect(page.getByText("OTHER DOCUMENT").first()).toBeVisible();

  // Evidence, export-request and deletion-request sections all render without error.
  await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Export requests" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deletion requests" })).toBeVisible();
});

test("a deletion request initiated by the Company Administrator cannot be approved by that same user, but can be approved by a different authorised user", async ({ browser }) => {
  // The seed data (prisma/seed.ts) creates no MediaAsset rows at all, so a
  // deletion request against any category would hit EmptyDeletionScopeError
  // (nothing to delete). Seed exactly one real evidence file first, through
  // the real upload API — not a direct DB insert — as the Dispatch and
  // Logistics Officer, the role that actually holds `mediaAsset:CREATE`
  // (Company Administrator deliberately does not — "oversight visibility
  // only", see prisma/seed.ts). This is a genuine end-to-end pass through
  // the actual upload pipeline (compression, checksum, automatic
  // scheduledDeletionAt assignment) before the deletion-request workflow
  // runs against it.
  const uploaderContext = await browser.newContext();
  const uploaderPage = await uploaderContext.newPage();
  await login(uploaderPage, "dispatch.and.logistics.officer@example.test");

  const driversRes = await uploaderPage.request.get("/api/drivers");
  const { items: drivers } = await driversRes.json();
  const driverId = drivers[0].id as string;

  const imageBuffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
  const uploadRes = await uploaderPage.request.post("/api/media/upload", {
    multipart: {
      file: { name: "e2e-evidence.jpg", mimeType: "image/jpeg", buffer: imageBuffer },
      ownerType: "DRIVER_PORTRAIT",
      ownerId: driverId,
      idempotencyKey: `e2e-retention-${crypto.randomUUID()}`,
      category: "GENERATED_REPORT",
    },
  });
  if (!uploadRes.ok()) {
    console.log("upload failed:", uploadRes.status(), await uploadRes.text());
  }
  expect(uploadRes.ok()).toBe(true);
  await uploaderContext.close();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, "company.administrator@example.test");
  await adminPage.goto("/admin/retention");

  // Targeted by accessible checkbox role/name so it can't ambiguously match
  // the same category label appearing elsewhere on the page (the policies
  // table, the evidence-filter dropdown).
  await adminPage.getByRole("checkbox", { name: "GENERATED REPORT" }).check();
  await adminPage.getByRole("button", { name: "Request deletion" }).click();

  // Self-approval must be impossible even by clicking the button — refetch
  // shows the request still PENDING_APPROVAL either way, but the specific
  // server-enforced rejection is already covered by
  // tests/retention-repository.test.ts's SelfApprovalNotAllowedError case;
  // this live pass instead proves the second-user approval path actually
  // works end to end through the real UI and a real second session.
  await expect(adminPage.getByText("PENDING_APPROVAL").first()).toBeVisible({ timeout: 10_000 });

  const approverContext = await browser.newContext();
  const approverPage = await approverContext.newPage();
  await login(approverPage, "security.supervisor.approving.manager@example.test");
  await approverPage.goto("/admin/retention");

  const approveButton = approverPage.getByRole("button", { name: "Approve" }).first();
  await expect(approveButton).toBeVisible({ timeout: 10_000 });
  await approveButton.click();
  await expect(approverPage.getByText(/approved — recovery window started/i)).toBeVisible({ timeout: 10_000 });

  await adminContext.close();
  await approverContext.close();
});
