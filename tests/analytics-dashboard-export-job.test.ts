import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/authorize";
import { prisma } from "@/lib/db/prisma";
import { getGovernanceAnalyticsDashboard, AnalyticsSupportingRecordError } from "@/lib/repositories/analytics-dashboard-repository";
import { calculateAnalyticsForTenant } from "@/lib/repositories/analytics-calculation-repository";
import { csvCell, generateGovernanceAnalyticsCsv, generateGovernanceAnalyticsReport, getGovernanceAnalyticsReportDownload } from "@/lib/repositories/analytics-export-repository";
import { renderGovernanceAnalyticsPdf } from "@/lib/analytics/governance-analytics-pdf";
import { createInvestigationCase } from "@/lib/repositories/investigation-case-repository";
import { JobAlreadyRunningError, runJob } from "@/lib/jobs/run-job";
import { createTenant } from "./helpers/fixtures";
import { createExceptionSeries, createOperationalAnalyticsFixture, makeAnalyticsManagerSession, makeAnalyticsManagerSessionForTenant, makeAnalyticsViewerSessionForTenant } from "./helpers/analytics-fixtures";

describe("governance analytics dashboard", () => {
  it("calculates correct bounded aggregates and applies site, vehicle and severity filters", async () => {
    const { tenant, session, user } = await makeAnalyticsManagerSession();
    const now = new Date();
    const fixture = await createOperationalAnalyticsFixture(tenant, user.id, new Date(now.getTime() - 60_000));
    await createOperationalAnalyticsFixture(tenant, user.id, new Date(now.getTime() - 60_000));
    await createExceptionSeries({ tenantId: tenant.id, gateEventId: fixture.gateEvent.id, raisedByUserId: user.id, count: 3, at: new Date(now.getTime() - 60_000), severity: "HIGH" });
    const dashboard = await getGovernanceAnalyticsDashboard(session, { siteId: fixture.site.id, vehicleId: fixture.vehicle.id, severity: "HIGH" }, now);
    expect(dashboard.executive.totalAuthorisedMovements).toBe(1);
    expect(dashboard.executive.completedMovements).toBe(1);
    expect(dashboard.executive.gateEntries).toBe(1);
    expect(dashboard.executive.criticalAndHighExceptions).toBe(3);
    expect(dashboard.operational.lateDepartures).toBe(1);
    expect(dashboard.operational.lateReturns).toBe(1);
    expect(dashboard.period.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dashboard.tenant.timezone).toBe("Africa/Johannesburg");
    const gateAndDriver = await getGovernanceAnalyticsDashboard(session, { gateId: fixture.gate.id, driverId: fixture.driver.id }, now);
    expect(gateAndDriver.executive.totalAuthorisedMovements).toBe(1);
    expect(gateAndDriver.executive.gateEntries).toBe(1);
  });

  it("rejects foreign filter IDs with a generic tenant-safe error", async () => {
    const tenantA = await createTenant("Dashboard A");
    const tenantB = await createTenant("Dashboard B");
    const { session: sessionA, user: userA } = await makeAnalyticsManagerSessionForTenant(tenantA);
    const { user: userB } = await makeAnalyticsManagerSessionForTenant(tenantB);
    await createOperationalAnalyticsFixture(tenantA, userA.id);
    const foreign = await createOperationalAnalyticsFixture(tenantB, userB.id);
    await expect(getGovernanceAnalyticsDashboard(sessionA, { vehicleId: foreign.vehicle.id })).rejects.toBeInstanceOf(AnalyticsSupportingRecordError);
  });

  it("exposes only aggregated investigation analytics and never confidential narratives or identities", async () => {
    const { session, tenant } = await makeAnalyticsManagerSession();
    await createInvestigationCase(session, { title: "CONFIDENTIAL ANALYTICS SENTINEL", description: "PROTECTED ALLEGATION SENTINEL", source: "MANUAL_CONCERN", confidentiality: "HIGHLY_RESTRICTED" });
    const dashboard = await getGovernanceAnalyticsDashboard(session);
    const serialized = JSON.stringify(dashboard);
    expect(dashboard.investigations.byStatus.DRAFT).toBeGreaterThanOrEqual(1);
    expect(serialized).not.toContain("CONFIDENTIAL ANALYTICS SENTINEL");
    expect(serialized).not.toContain("PROTECTED ALLEGATION SENTINEL");
    expect(serialized).not.toMatch(/templateCiphertext|templateAuthTag/);
    expect(dashboard.investigations.confidentialityStatement).toMatch(/aggregated/i);
    expect(tenant.id).toBe(session.tenantId);
  });

  it("labels mock and unavailable tracker sources without calling them live", async () => {
    const { tenant, session, user } = await makeAnalyticsManagerSession();
    const fixture = await createOperationalAnalyticsFixture(tenant, user.id);
    await prisma.vehicle.update({ where: { id: fixture.vehicle.id }, data: { gpsProvider: "mock", gpsDeviceReference: "mock-unit", gpsStatus: "ACTIVE", gpsLastCommunicationAt: new Date() } });
    await prisma.telematicsEvent.create({ data: { tenantId: tenant.id, vehicleId: fixture.vehicle.id, source: "PROVIDER", recordedAt: new Date(), providerReference: "mock-dashboard" } });
    const dashboard = await getGovernanceAnalyticsDashboard(session);
    expect(dashboard.tracking.dataQuality).toBe("MOCK");
    expect(dashboard.tracking.sourceLabels).toContain("MOCK");
    expect(dashboard.tracking.sourceLabels).not.toContain("LIVE");
    expect(dashboard.tracking.limitation).toMatch(/No production tracker provider/i);
  });
});

describe("analytics CSV and PDF exports", () => {
  it("neutralises every spreadsheet formula-control prefix", () => {
    for (const payload of ["=1+1", "+cmd", "-10+20", "@SUM(A1:A2)", "\tFORMULA", "\rFORMULA"]) {
      expect(csvCell(payload)).toBe(`"'${payload.replaceAll('"', '""')}"`);
    }
    expect(csvCell("ordinary")).toBe('"ordinary"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it("exports filtered indicators with server-side permission and formula-injection protection", async () => {
    const { tenant, session, user } = await makeAnalyticsManagerSession();
    const now = new Date();
    const fixture = await createOperationalAnalyticsFixture(tenant, user.id, new Date(now.getTime() - 60_000));
    await prisma.vehicle.update({ where: { id: fixture.vehicle.id }, data: { registrationNumber: "=HYPERLINK(\"bad\")" } });
    await createExceptionSeries({ tenantId: tenant.id, gateEventId: fixture.gateEvent.id, raisedByUserId: user.id, count: 3, at: new Date(now.getTime() - 60_000) });
    await calculateAnalyticsForTenant(tenant.id, now);
    const result = await generateGovernanceAnalyticsCsv(session, { vehicleId: fixture.vehicle.id }, now);
    expect(result.csv.startsWith("\uFEFF")).toBe(true);
    expect(result.csv).toContain("RISK_INDICATOR");
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.csv).toMatch(/Human review required/);
    expect(result.csv).not.toMatch(/templateCiphertext|templateAuthTag/);

    const { session: viewer } = await makeAnalyticsViewerSessionForTenant(tenant);
    await expect(generateGovernanceAnalyticsCsv(viewer, {}, now)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("renders a readable governance report with data quality and neutral disclaimer", async () => {
    const { session } = await makeAnalyticsManagerSession();
    const dashboard = await getGovernanceAnalyticsDashboard(session);
    const pdf = await renderGovernanceAnalyticsPdf(dashboard, "Synthetic Test Reviewer", new Date("2026-08-11T10:00:00Z"));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const text = pdf.toString("latin1");
    const decodedTextFragments = [...text.matchAll(/<([0-9a-f]+)>/gi)]
      .map((match) => match[1].length % 2 === 0 ? Buffer.from(match[1], "hex").toString("latin1") : "")
      .join("");
    expect(decodedTextFragments).toContain("Governance Analytics Report");
    expect(decodedTextFragments).toContain("Human review required");
    expect(decodedTextFragments).toContain("Data quality and tracking transparency");
    expect(decodedTextFragments).not.toMatch(/templateCiphertext|templateAuthTag/);
  });

  it("stores reports tenant-scoped and enforces export independently on download", async () => {
    const { tenant, session } = await makeAnalyticsManagerSession();
    const report = await generateGovernanceAnalyticsReport(session);
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: report.id } });
    expect(stored.tenantId).toBe(tenant.id);
    expect(stored.ownerType).toBe("GOVERNANCE_ANALYTICS_REPORT");
    expect(stored.ownerId).toBe(tenant.id);
    expect((await getGovernanceAnalyticsReportDownload(session, report.id))?.url).toMatch(/^\/api\/media\/raw\?/);

    const otherTenant = await createTenant("Report foreign tenant");
    const { session: otherManager } = await makeAnalyticsManagerSessionForTenant(otherTenant);
    await expect(getGovernanceAnalyticsReportDownload(otherManager, report.id)).rejects.toMatchObject({ name: "AnalyticsReportNotFoundError" });
    const { session: viewer } = await makeAnalyticsViewerSessionForTenant(tenant);
    await expect(getGovernanceAnalyticsReportDownload(viewer, report.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("scheduled analytics job safety", () => {
  it("prevents overlapping execution and records success without external messages", async () => {
    const jobName = `analytics.test.${crypto.randomUUID()}`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = runJob(jobName, async () => { await gate; return { count: 1 }; });
    while (await prisma.jobRun.count({ where: { jobName, status: "RUNNING" } }) === 0) await Promise.resolve();
    await expect(runJob(jobName, async () => ({ count: 2 }))).rejects.toBeInstanceOf(JobAlreadyRunningError);
    release();
    await expect(first).resolves.toEqual({ count: 1 });
    const runs = await prisma.jobRun.findMany({ where: { jobName } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
  });
});
