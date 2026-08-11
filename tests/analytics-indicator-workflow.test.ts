import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/authorize";
import { prisma } from "@/lib/db/prisma";
import { calculateAnalyticsForTenant } from "@/lib/repositories/analytics-calculation-repository";
import {
  AnalyticsIndicatorNotFoundError,
  AnalyticsIndicatorTransitionError,
  dismissAnalyticsIndicator,
  escalateAnalyticsIndicatorToInvestigation,
  getAnalyticsIndicator,
  listAnalyticsIndicators,
  markAnalyticsIndicatorReviewed,
  reopenAnalyticsIndicator,
} from "@/lib/repositories/analytics-indicator-repository";
import { createInvestigationCase } from "@/lib/repositories/investigation-case-repository";
import { createTenant } from "./helpers/fixtures";
import { makeSessionForTenant } from "./helpers/billing-session";
import { createExceptionSeries, createOperationalAnalyticsFixture, makeAnalyticsManagerSession, makeAnalyticsManagerSessionForTenant, makeAnalyticsViewerSessionForTenant } from "./helpers/analytics-fixtures";
import type { Prisma } from "@/generated/prisma/client";

async function indicatorFixture() {
  const context = await makeAnalyticsManagerSession();
  const now = new Date("2026-08-11T12:00:00Z");
  const operational = await createOperationalAnalyticsFixture(context.tenant, context.user.id, new Date(now.getTime() - 60_000));
  await createExceptionSeries({ tenantId: context.tenant.id, gateEventId: operational.gateEvent.id, raisedByUserId: context.user.id, count: 3, at: new Date(now.getTime() - 60_000) });
  await calculateAnalyticsForTenant(context.tenant.id, now);
  const indicator = await prisma.analyticsIndicator.findFirstOrThrow({ where: { tenantId: context.tenant.id, ruleCode: "REPEATED_VEHICLE_EXCEPTIONS" } });
  return { ...context, operational, indicator };
}

describe("analytics indicator access and review chronology", () => {
  it("requires indicator VIEW and returns a non-disclosing not-found result across tenants", async () => {
    const fixture = await indicatorFixture();
    const { session: noPermission } = await makeSessionForTenant(fixture.tenant, "No analytics", []);
    await expect(getAnalyticsIndicator(noPermission, fixture.indicator.id)).rejects.toBeInstanceOf(ForbiddenError);

    const otherTenant = await createTenant("Indicator other tenant");
    const { session: otherSession } = await makeAnalyticsManagerSessionForTenant(otherTenant);
    await expect(getAnalyticsIndicator(otherSession, fixture.indicator.id)).rejects.toBeInstanceOf(AnalyticsIndicatorNotFoundError);
    expect((await listAnalyticsIndicators(otherSession)).total).toBe(0);
  });

  it("filters supporting records using independent underlying-resource permissions", async () => {
    const fixture = await indicatorFixture();
    const full = await getAnalyticsIndicator(fixture.session, fixture.indicator.id);
    expect(full.supportingRecords).toHaveLength(3);
    expect(full.withheldSupportingRecordCount).toBe(0);

    const foreignTenant = await createTenant("Foreign supporting record tenant");
    const { user: foreignUser } = await makeAnalyticsManagerSessionForTenant(foreignTenant);
    const foreignOperational = await createOperationalAnalyticsFixture(foreignTenant, foreignUser.id);
    const [foreignException] = await createExceptionSeries({ tenantId: foreignTenant.id, gateEventId: foreignOperational.gateEvent.id, raisedByUserId: foreignUser.id, count: 1 });
    const storedReferences = fixture.indicator.supportingRecords as Prisma.JsonArray;
    const injectedReferences = [...storedReferences, { type: "EXCEPTION", id: foreignException.id, occurredAt: foreignException.raisedAt.toISOString(), summary: "FOREIGN SUPPORTING RECORD MUST NOT LEAK" }] as Prisma.InputJsonValue;
    await prisma.analyticsIndicator.update({ where: { id: fixture.indicator.id }, data: { supportingRecords: injectedReferences } });
    const tenantChecked = await getAnalyticsIndicator(fixture.session, fixture.indicator.id);
    expect(tenantChecked.supportingRecords).toHaveLength(3);
    expect(tenantChecked.withheldSupportingRecordCount).toBe(1);
    expect(JSON.stringify(tenantChecked.supportingRecords)).not.toContain(foreignException.id);
    expect(JSON.stringify(tenantChecked.supportingRecords)).not.toContain("FOREIGN SUPPORTING RECORD MUST NOT LEAK");

    const { session: viewer } = await makeAnalyticsViewerSessionForTenant(fixture.tenant);
    const restricted = await getAnalyticsIndicator(viewer, fixture.indicator.id);
    expect(restricted.supportingRecords).toHaveLength(0);
    expect(restricted.withheldSupportingRecordCount).toBe(4);
    expect(JSON.stringify(restricted)).not.toMatch(/templateCiphertext|templateAuthTag|descriptor/i);
  });

  it("records review, dismissal and reopening as append-only chronology and audit events", async () => {
    const fixture = await indicatorFixture();
    await markAnalyticsIndicatorReviewed(fixture.session, fixture.indicator.id, "Reviewed operating context and source records.");
    await dismissAnalyticsIndicator(fixture.session, fixture.indicator.id, "Explained variance accepted for this period.");
    await reopenAnalyticsIndicator(fixture.session, fixture.indicator.id, "New contextual information warrants another review.");
    const detail = await getAnalyticsIndicator(fixture.session, fixture.indicator.id);
    expect(detail.status).toBe("OPEN");
    expect(detail.events.map((event) => event.action)).toEqual(["reviewed", "dismissed", "reopened"]);
    expect(detail.events.map((event) => event.note)).toEqual([
      "Reviewed operating context and source records.",
      "Explained variance accepted for this period.",
      "New contextual information warrants another review.",
    ]);
    expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenant.id, entityType: "AnalyticsIndicator", entityId: fixture.indicator.id } })).toBe(3);
    expect(await prisma.analyticsIndicator.count({ where: { id: fixture.indicator.id } })).toBe(1);
  });

  it("enforces lifecycle transitions and does not permit dismissal to delete history", async () => {
    const fixture = await indicatorFixture();
    await expect(reopenAnalyticsIndicator(fixture.session, fixture.indicator.id, "Cannot reopen an already-open record.")).rejects.toBeInstanceOf(AnalyticsIndicatorTransitionError);
    await dismissAnalyticsIndicator(fixture.session, fixture.indicator.id, "Accepted variance.");
    await expect(markAnalyticsIndicatorReviewed(fixture.session, fixture.indicator.id, "Late review.")).rejects.toBeInstanceOf(AnalyticsIndicatorTransitionError);
    expect(await prisma.analyticsIndicatorEvent.count({ where: { indicatorId: fixture.indicator.id } })).toBe(1);
  });

  it("escalates only through an authorised human action and preserves the indicator", async () => {
    const fixture = await indicatorFixture();
    const result = await escalateAnalyticsIndicatorToInvestigation(fixture.session, fixture.indicator.id, "Repeated pattern merits a documented investigation.");
    expect(result.investigationCase.caseNumber).toMatch(/^INV-/);
    const indicator = await prisma.analyticsIndicator.findUniqueOrThrow({ where: { id: fixture.indicator.id } });
    expect(indicator.status).toBe("ESCALATED");
    expect(indicator.linkedInvestigationCaseId).toBe(result.investigationCase.id);
    const investigation = await prisma.investigationCase.findUniqueOrThrow({ where: { id: result.investigationCase.id } });
    expect(investigation.tenantId).toBe(fixture.tenant.id);
    expect(investigation.title).toMatch(/^Governance review:/);
    expect(investigation.description).toMatch(/authorised human review/i);
    expect(investigation.outcome).toBe("NOT_DETERMINED");
    expect(await prisma.investigationFinding.count({ where: { caseId: investigation.id } })).toBe(0);
    expect(await prisma.analyticsIndicator.count({ where: { id: fixture.indicator.id } })).toBe(1);
  });

  it("rejects cross-tenant investigation linkage without revealing the foreign case", async () => {
    const fixture = await indicatorFixture();
    const otherTenant = await createTenant("Foreign investigation tenant");
    const { session: otherManager } = await makeAnalyticsManagerSessionForTenant(otherTenant);
    const otherCase = await createInvestigationCase(otherManager, { title: "Foreign case", description: "Must remain isolated", source: "OTHER" });
    await expect(escalateAnalyticsIndicatorToInvestigation(fixture.session, fixture.indicator.id, "Attempted linkage", otherCase.id)).rejects.toMatchObject({ name: "InvestigationCaseNotFoundError" });
    expect((await prisma.analyticsIndicator.findUniqueOrThrow({ where: { id: fixture.indicator.id } })).linkedInvestigationCaseId).toBeNull();
  });

  it("bounds pagination and isolates list filters", async () => {
    const fixture = await indicatorFixture();
    const page = await listAnalyticsIndicators(fixture.session, { page: 1, pageSize: 10_000, subjectType: "VEHICLE", subjectId: fixture.operational.vehicle.id });
    expect(page.pageSize).toBe(100);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.subjectId === fixture.operational.vehicle.id)).toBe(true);
  });
});
