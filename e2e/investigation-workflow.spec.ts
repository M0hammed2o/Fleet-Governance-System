import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { loginNewContext } from "./helpers/billing-fixtures";

const TENANT = "acme-logistics";
const MANAGER_EMAIL = "security.supervisor.approving.manager@example.test";
const INVESTIGATOR_EMAIL = "internal.investigator.auditor@example.test";
const ADMIN_EMAIL = "company.administrator@example.test";
const EXTERNAL_AUDITOR_EMAIL = "external.auditor.case.scoped@example.test";
const REFERRER_EMAIL = "gate.security.officer@example.test";

async function seededUserIds(browser: Browser) {
  const { context, page } = await loginNewContext(browser, TENANT, ADMIN_EMAIL);
  const response = await page.request.get("/api/admin/users");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const byEmail = new Map<string, string>(body.users.map((user: { email: string; id: string }) => [user.email, user.id]));
  await context.close();
  return {
    managerId: byEmail.get(MANAGER_EMAIL)!,
    investigatorId: byEmail.get(INVESTIGATOR_EMAIL)!,
    externalAuditorId: byEmail.get(EXTERNAL_AUDITOR_EMAIL)!,
  };
}

async function caseIdFromDashboard(page: Page, title: string) {
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible();
  const href = await row.getByRole("link").getAttribute("href");
  expect(href).toMatch(/^\/investigations\//);
  return href!.split("/").at(-1)!;
}

test("manual investigation runs from intake through evidence, approval, report, closure and revoked external audit", async ({ browser }, testInfo) => {
  // The test deliberately exercises the full multi-role case lifecycle,
  // evidence/PDF generation and a second portal. Locator waits stay bounded,
  // while the complete cold-server workflow gets a realistic full-gate budget.
  test.setTimeout(240_000);
  const ids = await seededUserIds(browser);
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = `E2E governance case ${suffix}`;
  const unrelatedTitle = `E2E unrelated case ${suffix}`;
  const restrictedNote = `restricted-internal-note-${suffix}`;

  const { context: managerContext, page: managerPage } = await loginNewContext(browser, TENANT, MANAGER_EMAIL);
  await managerPage.goto("/investigations");
  await expect(managerPage.getByRole("heading", { name: "Investigations" })).toBeVisible();
  await managerPage.getByRole("button", { name: "New case" }).click();
  await managerPage.getByLabel("Case title").fill(title);
  await managerPage.getByLabel("Case description").fill("A neutral allegation requiring documented review.");
  await managerPage.getByLabel("Case owner user id").fill(ids.managerId);
  await managerPage.getByRole("button", { name: "Create", exact: true }).click();
  await expect(managerPage.getByText("Case created.")).toBeVisible();
  const caseId = await caseIdFromDashboard(managerPage, title);

  await managerPage.getByRole("button", { name: "New case" }).click();
  await managerPage.getByLabel("Case title").fill(unrelatedTitle);
  await managerPage.getByLabel("Case description").fill("This case must not appear in the external portal.");
  await managerPage.getByLabel("Case owner user id").fill(ids.managerId);
  await managerPage.getByRole("button", { name: "Create", exact: true }).click();
  await expect(managerPage.getByText("Case created.")).toBeVisible();

  await managerPage.goto(`/investigations/${caseId}`);
  await managerPage.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(managerPage.getByText("Submitted for triage.", { exact: true })).toBeVisible();
  await managerPage.getByRole("button", { name: "Triage", exact: true }).click();
  await expect(managerPage.getByText("Triaged.", { exact: true })).toBeVisible();
  managerPage.once("dialog", (dialog) => dialog.accept(ids.investigatorId));
  await managerPage.getByRole("button", { name: "Assign investigator" }).click();
  await expect(managerPage.getByText("Investigator assigned.", { exact: true })).toBeVisible();

  const { context: investigatorContext, page: investigatorPage } = await loginNewContext(browser, TENANT, INVESTIGATOR_EMAIL);
  await investigatorPage.goto(`/investigations/${caseId}`);
  await investigatorPage.getByRole("button", { name: "Begin investigation" }).click();
  await expect(investigatorPage.getByText("Investigation began.", { exact: true })).toBeVisible();

  await investigatorPage.getByLabel("Subject role").selectOption("WITNESS");
  await investigatorPage.getByLabel("Subject or party name").fill("Independent witness");
  await investigatorPage.getByRole("button", { name: "Add case party" }).click();
  await expect(investigatorPage.getByText("Independent witness")).toBeVisible();
  investigatorPage.once("dialog", (dialog) => dialog.accept("The witness provided a contemporaneous explanation."));
  await investigatorPage.getByRole("button", { name: "Record response" }).click();
  await expect(investigatorPage.getByText(/contemporaneous explanation/)).toBeVisible();

  await investigatorPage.getByLabel("Investigation note").fill("Standard interview note.");
  await investigatorPage.getByRole("button", { name: "Add note" }).click();
  await expect(investigatorPage.getByText("Standard interview note.")).toBeVisible();
  await investigatorPage.getByLabel("Investigation note").fill(restrictedNote);
  await investigatorPage.getByLabel("Note confidentiality").selectOption("RESTRICTED");
  await investigatorPage.getByRole("button", { name: "Add note" }).click();
  await expect(investigatorPage.getByText(restrictedNote)).toBeVisible();

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  await investigatorPage.getByLabel("Task description").fill("Obtain signed statement");
  await investigatorPage.getByLabel("Task assignee user id").fill(ids.investigatorId);
  await investigatorPage.getByLabel("Task due date").fill(yesterday);
  await investigatorPage.getByRole("button", { name: "Add task" }).click();
  const openTask = investigatorPage.getByRole("listitem").filter({ hasText: "Obtain signed statement" }).filter({ has: investigatorPage.getByRole("button", { name: "Mark done" }) });
  await expect(openTask).toBeVisible();
  await openTask.getByRole("button", { name: "Mark done" }).click();
  await expect(investigatorPage.getByRole("listitem").filter({ hasText: /Obtain signed statement.*DONE/ })).toBeVisible();

  const evidenceBytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#64748b" } }).png().toBuffer();
  await investigatorPage.getByLabel("Evidence file").setInputFiles({ name: `evidence-${suffix}.png`, mimeType: "image/png", buffer: evidenceBytes });
  await investigatorPage.getByLabel("Uploaded evidence description").fill("Timestamped scene photograph");
  await investigatorPage.getByRole("button", { name: "Upload evidence" }).click();
  await expect(investigatorPage.getByRole("listitem").filter({ hasText: "Timestamped scene photograph" }).filter({ has: investigatorPage.getByRole("button", { name: "Download" }) })).toBeVisible();
  await expect(investigatorPage.getByText(/Evidence item #1 linked/)).toBeVisible();

  await investigatorPage.getByLabel("Finding executive summary").fill("The allegation is substantiated on the available evidence.");
  await investigatorPage.getByLabel("Finding details").fill("The witness response and timestamped evidence corroborate the reported sequence.");
  await investigatorPage.getByLabel("Finding outcome").selectOption("SUBSTANTIATED");
  await investigatorPage.getByRole("button", { name: "Draft finding" }).click();
  await expect(investigatorPage.getByText(/v1.*DRAFT.*SUBSTANTIATED/)).toBeVisible();
  await investigatorPage.getByRole("button", { name: "Submit for approval" }).click();
  await expect(investigatorPage.getByText("Submitted for approval.", { exact: true })).toBeVisible();

  const findingList = await investigatorPage.request.get(`/api/investigations/${caseId}/findings`);
  const findingId = (await findingList.json()).findings[0].id as string;
  const selfApproval = await investigatorPage.request.post(`/api/investigations/${caseId}/findings/${findingId}/approve`, { data: {} });
  expect(selfApproval.status()).toBe(403);
  await investigatorContext.close();

  await managerPage.goto(`/investigations/${caseId}`);
  await managerPage.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(managerPage.getByText("Finding approved.", { exact: true })).toBeVisible();
  await managerPage.getByRole("button", { name: "Generate report" }).click();
  await expect(managerPage.getByText("Report generated.", { exact: true })).toBeVisible();
  const reportsResponse = await managerPage.request.get(`/api/investigations/${caseId}/reports`);
  const reportsBody = await reportsResponse.json();
  expect(reportsBody.reports).toHaveLength(1);
  const reportId = reportsBody.reports[0].id as string;
  const reportLinkResponse = await managerPage.request.get(`/api/investigations/${caseId}/reports/${reportId}/download`);
  expect(reportLinkResponse.ok()).toBe(true);
  const reportLink = await reportLinkResponse.json();
  const reportBytesResponse = await managerPage.request.get(reportLink.url);
  expect(reportBytesResponse.ok()).toBe(true);
  const reportBytes = await reportBytesResponse.body();
  expect(reportBytes.subarray(0, 5).toString()).toBe("%PDF-");
  const reportArtifactPath = testInfo.outputPath("investigation-report.pdf");
  await writeFile(reportArtifactPath, reportBytes);
  await testInfo.attach("investigation-report", { path: reportArtifactPath, contentType: "application/pdf" });

  await managerPage.getByRole("button", { name: "Close case" }).click();
  await expect(managerPage.getByText("Case closed.", { exact: true })).toBeVisible();
  await expect(managerPage.getByText("Evidence hold ACTIVE")).toBeVisible();
  await expect(managerPage.getByText(/Outcome:.*SUBSTANTIATED/)).toBeVisible();
  const caseScreenshotPath = testInfo.outputPath("closed-investigation-ui.png");
  await managerPage.screenshot({ path: caseScreenshotPath, fullPage: true });
  await testInfo.attach("closed-investigation-ui", { path: caseScreenshotPath, contentType: "image/png" });

  await managerPage.goto("/investigations/external-access");
  await managerPage.getByLabel("External auditor user id").fill(ids.externalAuditorId);
  await managerPage.getByLabel("Granted case ids").fill(caseId);
  await managerPage.getByLabel("External access reason").fill("Independent year-end assurance review");
  await managerPage.getByLabel("External access expiry").fill("2099-12-31T12:00");
  await managerPage.getByRole("checkbox", { name: "Can download report" }).check();
  await managerPage.getByRole("checkbox", { name: "Can download evidence" }).check();
  await managerPage.getByRole("button", { name: "Grant access" }).click();
  await expect(managerPage.getByText(/Access granted/)).toBeVisible();

  const grantsResponse = await managerPage.request.get(`/api/investigations/external-access?caseId=${caseId}`);
  const grantId = (await grantsResponse.json()).grants[0].id as string;
  const { context: auditorContext, page: auditorPage } = await loginNewContext(browser, TENANT, EXTERNAL_AUDITOR_EMAIL);
  await auditorPage.goto("/external-auditor");
  await expect(auditorPage.getByText(title)).toBeVisible();
  await expect(auditorPage.getByText(unrelatedTitle)).toHaveCount(0);
  await auditorPage.getByRole("link").filter({ hasText: /^INV-/ }).click();
  await expect(auditorPage.getByText("Timestamped scene photograph")).toBeVisible();
  await expect(auditorPage.getByText(restrictedNote)).toHaveCount(0);
  await expect(auditorPage.getByText(/\.pdf/)).toBeVisible();
  const externalMutation = await auditorPage.request.post(`/api/investigations/${caseId}/notes`, { data: { content: "Must remain read-only" } });
  expect(externalMutation.status()).toBe(403);

  await managerPage.goto("/investigations/external-access");
  managerPage.once("dialog", (dialog) => dialog.accept("Assurance review completed"));
  await managerPage.getByRole("button", { name: "Revoke" }).first().click();
  await expect(managerPage.getByText("Access revoked immediately.")).toBeVisible();
  await auditorPage.goto("/external-auditor");
  await expect(auditorPage.getByText("No cases are currently accessible to you.")).toBeVisible();
  expect((await auditorPage.request.get(`/api/external-auditor/cases/${caseId}`)).status()).toBe(403);
  expect(grantId).toBeTruthy();

  await auditorContext.close();
  await managerContext.close();
});

test("gate officer referral is duplicate-safe and leaves the source exception unchanged", async ({ browser }) => {
  test.setTimeout(90_000);
  const { managerId } = await seededUserIds(browser);
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = `E2E referred exception ${suffix}`;
  const sourceDescription = `E2E immutable exception ${suffix}`;
  const { context: referrerContext, page: referrerPage } = await loginNewContext(browser, TENANT, REFERRER_EMAIL);

  const gateEventsResponse = await referrerPage.request.get("/api/gate/gate-events");
  expect(gateEventsResponse.ok()).toBe(true);
  const gateEvents = (await gateEventsResponse.json()).items as Array<{ id: string }>;
  expect(gateEvents.length).toBeGreaterThan(0);
  const createException = await referrerPage.request.post(`/api/gate/gate-events/${gateEvents[0].id}/exceptions`, {
    data: { description: sourceDescription, severity: "HIGH", requiresSupervisorApproval: true },
  });
  expect(createException.ok()).toBe(true);
  const sourceException = (await createException.json()).exception as { id: string; resolvedAt: string | null; outcomeAction: string | null };

  async function referThroughUi(expectedNotice: RegExp) {
    await referrerPage.goto("/investigations");
    await referrerPage.getByRole("button", { name: "Refer a record" }).click();
    await referrerPage.getByLabel("Referral source type").selectOption("EXCEPTION");
    await referrerPage.getByLabel("Referral source record id").fill(sourceException.id);
    await referrerPage.getByLabel("Referral case title").fill(title);
    await referrerPage.getByLabel("Referral case owner user id").fill(managerId);
    await referrerPage.getByRole("button", { name: "Refer", exact: true }).click();
    await expect(referrerPage.getByText(expectedNotice)).toBeVisible();
  }

  await referThroughUi(/Case created from referral/);
  await referThroughUi(/open case already existed/i);
  const refreshedSource = await referrerPage.request.get(`/api/gate/gate-events/${gateEvents[0].id}/exceptions`);
  const sourceAfter = (await refreshedSource.json()).exceptions.find((item: { id: string }) => item.id === sourceException.id);
  expect(sourceAfter).toMatchObject({ resolvedAt: null, outcomeAction: null, description: sourceDescription });
  expect((await referrerPage.request.get("/api/investigations")).status()).toBe(403);

  const { context: managerContext, page: managerPage } = await loginNewContext(browser, TENANT, MANAGER_EMAIL);
  await managerPage.goto("/investigations");
  const caseId = await caseIdFromDashboard(managerPage, title);
  await managerPage.goto(`/investigations/${caseId}`);
  await expect(managerPage.getByText(sourceException.id)).toBeVisible();
  await expect(managerPage.getByText("referral source")).toBeVisible();
  await managerContext.close();
  await referrerContext.close();
});
