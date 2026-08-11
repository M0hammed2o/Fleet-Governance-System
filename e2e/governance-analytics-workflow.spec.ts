import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { expect, test, type Browser } from "@playwright/test";
import { Pool } from "pg";
import { loginNewContext } from "./helpers/billing-fixtures";

dotenv.config({ quiet: true });

const TENANT = "acme-logistics";
const MANAGER_EMAIL = "security.supervisor.approving.manager@example.test";
const EXECUTIVE_EMAIL = "executive.read.only.viewer@example.test";
const GATE_OFFICER_EMAIL = "gate.security.officer@example.test";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for deterministic analytics browser fixtures.");
const database = new Pool({ connectionString });

async function ensureAnalyticsRules(browser: Browser) {
  const { context, page } = await loginNewContext(browser, TENANT, MANAGER_EMAIL);
  const response = await page.request.post("/api/analytics/calculate");
  expect(response.ok()).toBe(true);
  await context.close();
}

async function seedTenantIndicator(title: string) {
  const tenant = (await database.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [TENANT])).rows[0];
  if (!tenant) throw new Error("Seed tenant not found.");
  const rule = (await database.query<{ id: string; code: string; version: number; evaluationPeriodDays: number; minimumOccurrenceCount: number; cooldownDays: number }>('SELECT id, code, version, "evaluationPeriodDays", "minimumOccurrenceCount", "cooldownDays" FROM analytics_rules WHERE "tenantId" = $1 AND "supersededAt" IS NULL ORDER BY code LIMIT 1', [tenant.id])).rows[0];
  const vehicle = (await database.query<{ id: string; registrationNumber: string }>('SELECT id, "registrationNumber" FROM vehicles WHERE "tenantId" = $1 ORDER BY "createdAt" LIMIT 1', [tenant.id])).rows[0];
  const exception = (await database.query<{ id: string; raisedAt: Date }>('SELECT id, "raisedAt" FROM exceptions WHERE "tenantId" = $1 ORDER BY "raisedAt" DESC LIMIT 1', [tenant.id])).rows[0];
  if (!rule || !vehicle) throw new Error("Analytics rule or vehicle fixture not found.");
  const now = new Date();
  const evaluationStart = new Date(now.getTime() - 7 * 86_400_000);
  const id = `e2e-indicator-${crypto.randomUUID()}`;
  const ruleSnapshot = {
        evaluationPeriodDays: rule.evaluationPeriodDays,
        minimumOccurrenceCount: rule.minimumOccurrenceCount,
        severity: "HIGH",
        cooldownDays: rule.cooldownDays,
  };
  const supportingRecords = exception ? [{ type: "EXCEPTION", id: exception.id, occurredAt: exception.raisedAt.toISOString(), summary: "Local governance exception used by the deterministic browser fixture." }] : [];
  await database.query(
    'INSERT INTO analytics_indicators (id, "tenantId", "ruleId", "ruleCode", "ruleVersion", "ruleSnapshot", "evaluationStart", "evaluationEnd", "subjectType", "subjectId", "subjectLabel", severity, title, explanation, "recommendedAction", "supportingRecords", "dataQuality", "firstDetectedAt", "lastDetectedAt", "occurrenceCount", "calculationKey", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'VEHICLE\',$9,$10,\'HIGH\',$11,$12,$13,$14,\'COMPLETE\',$8,$8,3,$15,$8)',
    [id, tenant.id, rule.id, rule.code, rule.version, ruleSnapshot, evaluationStart, now, vehicle.id, vehicle.registrationNumber, title, "Three tenant-scoped local records met the configured deterministic threshold during the seven-day evaluation period.", "An authorised reviewer should inspect the supporting records and record relevant operational context.", JSON.stringify(supportingRecords), `e2e:${crypto.randomUUID()}`],
  );
  return { id, title };
}

async function seedForeignTenantIndicator() {
  const tenant = (await database.query<{ id: string; name: string }>("SELECT id, name FROM tenants WHERE slug = 'platform'")).rows[0];
  if (!tenant) throw new Error("Platform tenant not found.");
  const code = `E2E_FOREIGN_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const ruleId = `e2e-rule-${crypto.randomUUID()}`;
  await database.query('INSERT INTO analytics_rules (id, "tenantId", code, label, description, "configuredByUserId") VALUES ($1,$2,$3,$4,$5,NULL)', [ruleId, tenant.id, code, "Foreign tenant isolation fixture", "Synthetic local fixture used only to verify tenant isolation."]);
  const now = new Date();
  const indicatorId = `e2e-foreign-indicator-${crypto.randomUUID()}`;
  await database.query(
    'INSERT INTO analytics_indicators (id, "tenantId", "ruleId", "ruleCode", "ruleVersion", "ruleSnapshot", "evaluationStart", "evaluationEnd", "subjectType", "subjectId", "subjectLabel", severity, title, explanation, "recommendedAction", "supportingRecords", "dataQuality", "firstDetectedAt", "lastDetectedAt", "occurrenceCount", "calculationKey", "updatedAt") VALUES ($1,$2,$3,$4,1,$5,$6,$7,\'TENANT\',$2,$8,\'MEDIUM\',$9,$10,$11,$12,\'COMPLETE\',$7,$7,3,$13,$7)',
    [indicatorId, tenant.id, ruleId, code, { minimumOccurrenceCount: 3 }, new Date(now.getTime() - 86_400_000), now, tenant.name, "Foreign tenant indicator fixture", "This record must never be disclosed outside its tenant.", "No action; isolation test fixture.", JSON.stringify([]), `e2e:${crypto.randomUUID()}`],
  );
  return { indicatorId, ruleId };
}

test.describe.serial("Phase 12 governance analytics", () => {
  test.beforeAll(async ({ browser }) => ensureAnalyticsRules(browser));
  test.afterAll(async () => database.end());

  test("executive analytics supports filters, explainable review, dismissal, CSV and PDF", async ({ browser }, testInfo) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const indicatorTitle = `E2E repeated vehicle pattern ${suffix}`;
    const seededIndicator = await seedTenantIndicator(indicatorTitle);
    const { context, page } = await loginNewContext(browser, TENANT, MANAGER_EMAIL);

    await page.goto("/analytics/rules");
    await expect(page.getByRole("heading", { name: "Analytics rules" })).toBeVisible();
    await expect(page.getByText("System safe default").first()).toBeVisible();
    const rulesPath = testInfo.outputPath("governance-analytics-rule-configuration.png");
    await page.screenshot({ path: rulesPath, fullPage: true });
    await testInfo.attach("governance-analytics-rule-configuration", { path: rulesPath, contentType: "image/png" });

    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Executive analytics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Data quality:/ })).toBeVisible();
    await expect(page.getByLabel("Start date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByLabel("End date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByText(/Africa\/Johannesburg/)).toBeVisible();
    await expect(page.getByLabel("Site").locator("option")).not.toHaveCount(1);

    await page.getByLabel("Site").selectOption({ index: 1 });
    await page.getByLabel("Exception severity").selectOption("HIGH");
    const filteredResponse = page.waitForResponse((response) => response.url().includes("/api/analytics/dashboard?") && response.request().method() === "GET");
    await page.getByRole("button", { name: "Apply filters" }).click();
    expect((await filteredResponse).ok()).toBe(true);
    await expect(page.getByText(/active$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Executive governance summary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Authorised movements by day" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gate volume by day" })).toBeVisible();

    const dashboardPath = testInfo.outputPath("governance-analytics-dashboard-desktop.png");
    await page.screenshot({ path: dashboardPath, fullPage: true });
    await testInfo.attach("governance-analytics-dashboard-desktop", { path: dashboardPath, contentType: "image/png" });
    await page.setViewportSize({ width: 768, height: 1024 });
    const tabletPath = testInfo.outputPath("governance-analytics-dashboard-tablet.png");
    await page.screenshot({ path: tabletPath, fullPage: true });
    await testInfo.attach("governance-analytics-dashboard-tablet", { path: tabletPath, contentType: "image/png" });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePath = testInfo.outputPath("governance-analytics-dashboard-mobile.png");
    await page.screenshot({ path: mobilePath, fullPage: true });
    await testInfo.attach("governance-analytics-dashboard-mobile", { path: mobilePath, contentType: "image/png" });
    await page.setViewportSize({ width: 1280, height: 720 });

    const resetResponse = page.waitForResponse((response) => response.url().endsWith("/api/analytics/dashboard") && response.request().method() === "GET");
    await page.getByRole("button", { name: "Reset" }).click();
    expect((await resetResponse).ok()).toBe(true);
    // The dashboard is deliberately capped at 100 indicators. Navigate to
    // the fixture by its deterministic API identity so repeated local runs
    // cannot hide it behind older synthetic HIGH-severity rows.
    await page.goto(`/analytics/indicators/${seededIndicator.id}`);
    await expect(page.getByRole("heading", { name: "Why this triggered" })).toBeVisible();
    await expect(page.getByText(/not an accusation, finding, or automated decision/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supporting records" })).toBeVisible();

    await page.getByLabel("Review note").fill(`Reviewed against local records ${suffix}`);
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(page.getByRole("status")).toContainText("marked as reviewed");
    await page.getByLabel("Review note").fill(`Explained operational variance ${suffix}`);
    await page.getByRole("button", { name: "Dismiss as explained variance" }).click();
    await expect(page.getByRole("status")).toContainText("dismissed as an explained or accepted variance");
    await expect(page.getByRole("heading", { name: "Review chronology" })).toBeVisible();
    await expect(page.getByText(`Reviewed against local records ${suffix}`)).toBeVisible();
    await expect(page.getByText(`Explained operational variance ${suffix}`)).toBeVisible();

    const detailPath = testInfo.outputPath("governance-analytics-indicator-detail.png");
    await page.screenshot({ path: detailPath, fullPage: true });
    await testInfo.attach("governance-analytics-indicator-detail", { path: detailPath, contentType: "image/png" });

    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Executive analytics" })).toBeVisible();
    await page.getByLabel("Exception severity").selectOption("HIGH");
    const exportResponse = await page.request.get("/api/analytics/exports/csv?severity=HIGH");
    expect(exportResponse.ok()).toBe(true);
    expect(exportResponse.headers()["content-disposition"]).toContain("attachment");
    const csv = await exportResponse.text();
    expect(csv).toContain("Human review required");
    const csvPath = testInfo.outputPath("governance-analytics-filtered.csv");
    await writeFile(csvPath, csv);
    await testInfo.attach("governance-analytics-filtered-csv", { path: csvPath, contentType: "text/csv" });

    const reportResponse = await page.request.post("/api/analytics/reports", { data: { severity: "HIGH" } });
    expect(reportResponse.status()).toBe(201);
    const report = await reportResponse.json();
    const linkResponse = await page.request.get(`/api/analytics/reports/${report.report.id}/download`);
    expect(linkResponse.ok()).toBe(true);
    const { url } = await linkResponse.json();
    const bytesResponse = await page.request.get(url);
    expect(bytesResponse.ok()).toBe(true);
    const bytes = await bytesResponse.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const pdfPath = testInfo.outputPath("governance-analytics-report.pdf");
    await writeFile(pdfPath, bytes);
    await testInfo.attach("governance-analytics-report", { path: pdfPath, contentType: "application/pdf" });
    await context.close();
  });

  test("analytics view, export, confidentiality and route IDs remain independently isolated", async ({ browser }) => {
    const foreign = await seedForeignTenantIndicator();
    try {
      const { context: deniedContext, page: deniedPage } = await loginNewContext(browser, TENANT, GATE_OFFICER_EMAIL);
      await deniedPage.goto("/analytics");
      await expect(deniedPage.getByText("Forbidden", { exact: true })).toBeVisible();
      expect((await deniedPage.request.get("/api/analytics/dashboard")).status()).toBe(403);
      await deniedContext.close();

      const { context: managerContext, page: managerPage } = await loginNewContext(browser, TENANT, MANAGER_EMAIL);
      const confidentialTitle = `HIGHLY-RESTRICTED-ANALYTICS-SENTINEL-${crypto.randomUUID()}`;
      const createCase = await managerPage.request.post("/api/investigations", { data: { title: confidentialTitle, description: "This narrative must never enter aggregate analytics.", source: "MANUAL_CONCERN", category: "DATA_INTEGRITY", priority: "HIGH", confidentiality: "HIGHLY_RESTRICTED" } });
      expect(createCase.status()).toBe(201);
      expect((await managerPage.request.get(`/api/analytics/indicators/${foreign.indicatorId}`)).status()).toBe(404);
      expect((await managerPage.request.post(`/api/analytics/indicators/${foreign.indicatorId}/review`, { data: { note: "route tampering attempt" } })).status()).toBe(404);
      await managerContext.close();

      const { context: executiveContext, page: executivePage } = await loginNewContext(browser, TENANT, EXECUTIVE_EMAIL);
      await executivePage.goto("/analytics");
      await expect(executivePage.getByRole("heading", { name: "Executive analytics" })).toBeVisible();
      await expect(executivePage.getByText("Investigation analytics confidentiality")).toBeVisible();
      await expect(executivePage.getByText(confidentialTitle)).toHaveCount(0);
      await expect(executivePage.getByRole("link", { name: "Export filtered CSV" })).toHaveCount(0);
      await expect(executivePage.getByRole("button", { name: "Generate PDF report" })).toHaveCount(0);
      const aggregateResponse = await executivePage.request.get("/api/analytics/dashboard");
      expect(aggregateResponse.ok()).toBe(true);
      expect(await aggregateResponse.text()).not.toContain(confidentialTitle);
      expect((await executivePage.request.get("/api/analytics/exports/csv")).status()).toBe(403);
      await executiveContext.close();
    } finally {
      await database.query("DELETE FROM analytics_indicators WHERE id = $1", [foreign.indicatorId]);
      await database.query("DELETE FROM analytics_rules WHERE id = $1", [foreign.ruleId]);
    }
  });

  test("a deterministic indicator escalates to a tenant-scoped investigation without deletion", async ({ browser }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const indicator = await seedTenantIndicator(`E2E escalation pattern ${suffix}`);
    const tenant = (await database.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [TENANT])).rows[0];
    if (!tenant) throw new Error("Seed tenant not found.");
    const { context, page } = await loginNewContext(browser, TENANT, MANAGER_EMAIL);
    await page.goto(`/analytics/indicators/${indicator.id}`);
    await expect(page.getByRole("heading", { name: indicator.title })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supporting records" })).toBeVisible();
    await page.getByLabel("Escalation note").fill(`Manual investigation review requested ${suffix}`);
    await page.getByRole("button", { name: "Escalate for investigation" }).click();
    await expect(page.getByRole("status")).toContainText(/escalated and linked to INV-/);
    const caseLink = page.getByRole("link", { name: /^INV-/ });
    await expect(caseLink).toBeVisible();
    const caseId = (await caseLink.getAttribute("href"))!.split("/").at(-1)!;
    const persisted = (await database.query<{ status: string; linkedInvestigationCaseId: string | null }>('SELECT status, "linkedInvestigationCaseId" FROM analytics_indicators WHERE id = $1', [indicator.id])).rows[0];
    expect(persisted?.status).toBe("ESCALATED");
    expect(persisted?.linkedInvestigationCaseId).toBe(caseId);
    const linkedCase = (await database.query<{ tenantId: string }>('SELECT "tenantId" FROM investigation_cases WHERE id = $1', [caseId])).rows[0];
    expect(linkedCase?.tenantId).toBe(tenant.id);
    expect((await page.request.get(`/api/investigations/${caseId}`)).ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "Review chronology" })).toBeVisible();
    await expect(page.getByText(`Manual investigation review requested ${suffix}`)).toBeVisible();
    await context.close();
  });
});
