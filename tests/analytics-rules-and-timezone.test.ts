import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/authorize";
import { prisma } from "@/lib/db/prisma";
import { defaultReportingDateRange, InvalidAnalyticsPeriodError, localDateKey, reportingRangeFromDateOnly, subtractTenantCalendarDays, zonedDateTimeToUtc } from "@/lib/analytics/timezone";
import { createAnalyticsRuleVersion, ensureDefaultAnalyticsRules, listCurrentAnalyticsRules, AnalyticsRuleNotFoundError } from "@/lib/repositories/analytics-rule-repository";
import { createTenant } from "./helpers/fixtures";
import { makeSessionForTenant } from "./helpers/billing-session";
import { makeAnalyticsManagerSession, makeAnalyticsManagerSessionForTenant } from "./helpers/analytics-fixtures";

describe("tenant-local analytics reporting periods", () => {
  it("maps an Africa/Johannesburg local day to the correct UTC boundaries", () => {
    const range = reportingRangeFromDateOnly("2026-08-11", "2026-08-11", "Africa/Johannesburg");
    expect(range.start.toISOString()).toBe("2026-08-10T22:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-08-11T22:00:00.000Z");
  });

  it("handles daylight-saving offsets without assuming a fixed time zone offset", () => {
    expect(zonedDateTimeToUtc({ year: 2026, month: 1, day: 15 }, "America/New_York").toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(zonedDateTimeToUtc({ year: 2026, month: 7, day: 15 }, "America/New_York").toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("returns a bounded default range labelled in tenant-local dates", () => {
    const range = defaultReportingDateRange(new Date("2026-08-11T15:00:00Z"), "Africa/Johannesburg", 30);
    expect(range.endDate).toBe("2026-08-11");
    expect(localDateKey(range.start, "Africa/Johannesburg")).toBe("2026-07-13");
  });

  it("keeps default and calculation windows on tenant-local midnight across daylight saving", () => {
    const range = defaultReportingDateRange(new Date("2026-03-10T16:00:00Z"), "America/New_York", 3);
    expect(range.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-03-11T04:00:00.000Z");
    expect(subtractTenantCalendarDays(range.endExclusive, 3, "America/New_York").toISOString()).toBe(range.start.toISOString());
  });

  it("rejects partial, inverted and unbounded ranges", () => {
    expect(() => reportingRangeFromDateOnly("2026-01-01", undefined, "UTC")).toThrow(InvalidAnalyticsPeriodError);
    expect(() => reportingRangeFromDateOnly("2026-02-01", "2026-01-01", "UTC")).toThrow(InvalidAnalyticsPeriodError);
    expect(() => reportingRangeFromDateOnly("2024-01-01", "2026-01-01", "UTC")).toThrow(/limited to 366 days/);
  });
});

describe("versioned analytics rule configuration", () => {
  it("creates the complete safe-default catalogue idempotently", async () => {
    const tenant = await createTenant("Analytics defaults");
    await Promise.all([ensureDefaultAnalyticsRules(tenant.id), ensureDefaultAnalyticsRules(tenant.id), ensureDefaultAnalyticsRules(tenant.id)]);
    const rules = await prisma.analyticsRule.findMany({ where: { tenantId: tenant.id, supersededAt: null } });
    expect(rules).toHaveLength(12);
    expect(rules.every((rule) => rule.configuredByUserId === null)).toBe(true);
    expect(rules.find((rule) => rule.code === "SUDDEN_EXCEPTION_INCREASE")?.minimumSampleSize).toBe(3);
  });

  it("creates a new immutable version, records the actor, and preserves the old version", async () => {
    const { tenant, session, user } = await makeAnalyticsManagerSession();
    const rules = await listCurrentAnalyticsRules(session);
    const original = rules.find((rule) => rule.code === "REPEATED_VEHICLE_EXCEPTIONS")!;
    const updated = await createAnalyticsRuleVersion(session, original.id, { minimumOccurrenceCount: 5, severity: "HIGH" });
    expect(updated.version).toBe(2);
    expect(updated.minimumOccurrenceCount).toBe(5);
    expect(updated.configuredByUserId).toBe(user.id);
    const historical = await prisma.analyticsRule.findUniqueOrThrow({ where: { id: original.id } });
    expect(historical.version).toBe(1);
    expect(historical.minimumOccurrenceCount).toBe(3);
    expect(historical.supersededAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: "analytics.ruleVersionCreated", entityId: updated.id } })).toBe(1);
  });

  it("requires CONFIGURE independently from rule VIEW", async () => {
    const tenant = await createTenant("Rule permission");
    const { session } = await makeSessionForTenant(tenant, "Rule Viewer", [["analyticsRule", "VIEW"]]);
    const rule = (await listCurrentAnalyticsRules(session))[0];
    await expect(createAnalyticsRuleVersion(session, rule.id, { enabled: false })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not reveal or mutate another tenant's rule", async () => {
    const tenantA = await createTenant("Rules A");
    const tenantB = await createTenant("Rules B");
    const { session: sessionA } = await makeAnalyticsManagerSessionForTenant(tenantA);
    const { session: sessionB } = await makeAnalyticsManagerSessionForTenant(tenantB);
    const ruleA = (await listCurrentAnalyticsRules(sessionA))[0];
    await expect(createAnalyticsRuleVersion(sessionB, ruleA.id, { enabled: false })).rejects.toBeInstanceOf(AnalyticsRuleNotFoundError);
    expect((await prisma.analyticsRule.findUniqueOrThrow({ where: { id: ruleA.id } })).supersededAt).toBeNull();
  });
});
