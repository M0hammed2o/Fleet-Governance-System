import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { calculateAnalyticsForTenant } from "@/lib/repositories/analytics-calculation-repository";
import { createAnalyticsRuleVersion, listCurrentAnalyticsRules } from "@/lib/repositories/analytics-rule-repository";
import { createTenant } from "./helpers/fixtures";
import { createExceptionSeries, createInspectionFailureSeries, createOperationalAnalyticsFixture, makeAnalyticsManagerSession, makeAnalyticsManagerSessionForTenant } from "./helpers/analytics-fixtures";

describe("deterministic analytics calculation", () => {
  it("generates explainable vehicle, driver, inspection and gate-review indicators from tenant records", async () => {
    const { tenant, session, user } = await makeAnalyticsManagerSession();
    const now = new Date("2026-08-11T12:00:00Z");
    const fixture = await createOperationalAnalyticsFixture(tenant, user.id, new Date(now.getTime() - 60_000));
    await createExceptionSeries({ tenantId: tenant.id, gateEventId: fixture.gateEvent.id, raisedByUserId: user.id, count: 3, at: new Date(now.getTime() - 60_000) });
    for (let index = 0; index < 2; index += 1) {
      const occurredAt = new Date(now.getTime() - (index + 2) * 60_000);
      const extraGateEvent = await prisma.gateEvent.create({
        data: {
          tenantId: tenant.id,
          siteId: fixture.site.id,
          gateId: fixture.gate.id,
          direction: "ENTRY",
          vehicleId: fixture.vehicle.id,
          driverId: fixture.driver.id,
          movementAuthorisationId: fixture.movement.id,
          securityOfficerUserId: user.id,
          status: "COMPLETED",
          startedAt: new Date(occurredAt.getTime() - 60_000),
          completedAt: occurredAt,
          decision: "CLEARED",
          decisionByUserId: user.id,
          decisionAt: occurredAt,
        },
      });
      await createExceptionSeries({ tenantId: tenant.id, gateEventId: extraGateEvent.id, raisedByUserId: user.id, count: 1, at: occurredAt });
    }
    await createInspectionFailureSeries({ tenantId: tenant.id, gateEventId: fixture.gateEvent.id, userId: user.id, count: 3, at: new Date(now.getTime() - 60_000) });

    const result = await calculateAnalyticsForTenant(tenant.id, now);
    expect(result?.indicatorsCreated).toBeGreaterThanOrEqual(3);
    const indicators = await prisma.analyticsIndicator.findMany({ where: { tenantId: tenant.id } });
    expect(indicators.map((item) => item.ruleCode)).toEqual(expect.arrayContaining(["REPEATED_VEHICLE_EXCEPTIONS", "REPEATED_DRIVER_EXCEPTIONS", "REPEATED_INSPECTION_FAILURES", "REPEATED_GATE_OVERRIDES"]));
    expect(indicators.every((item) => /configured minimum|configured stale-data threshold|configured threshold/.test(item.explanation))).toBe(true);
    expect(indicators.every((item) => !/fraudulent|dishonest|guilty/i.test(`${item.title} ${item.explanation}`))).toBe(true);
    expect(await prisma.investigationCase.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.investigationNotificationRecord.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(session.tenantId).toBe(tenant.id);
  });

  it("is retry-safe and database-constrained under simultaneous calculations", async () => {
    const { tenant, user } = await makeAnalyticsManagerSession();
    const now = new Date("2026-08-11T13:00:00Z");
    const fixture = await createOperationalAnalyticsFixture(tenant, user.id, new Date(now.getTime() - 60_000));
    await createExceptionSeries({ tenantId: tenant.id, gateEventId: fixture.gateEvent.id, raisedByUserId: user.id, count: 3, at: new Date(now.getTime() - 60_000) });
    await Promise.all(Array.from({ length: 8 }, () => calculateAnalyticsForTenant(tenant.id, now)));
    expect(await prisma.analyticsIndicator.count({ where: { tenantId: tenant.id, ruleCode: "REPEATED_VEHICLE_EXCEPTIONS", subjectId: fixture.vehicle.id } })).toBe(1);
    const indicator = await prisma.analyticsIndicator.findFirstOrThrow({ where: { tenantId: tenant.id, ruleCode: "REPEATED_VEHICLE_EXCEPTIONS", subjectId: fixture.vehicle.id } });
    expect(indicator.occurrenceCount).toBe(3);
    expect(await prisma.analyticsCalculationRun.count({ where: { tenantId: tenant.id, status: "FAILED" } })).toBe(0);
  }, 60_000);

  it("honours minimum occurrence/sample thresholds and rule versions without rewriting an existing snapshot", async () => {
    const { tenant, session, user } = await makeAnalyticsManagerSession();
    const now = new Date("2026-08-11T14:00:00Z");
    const fixture = await createOperationalAnalyticsFixture(tenant, user.id, new Date(now.getTime() - 60_000));
    await createExceptionSeries({ tenantId: tenant.id, gateEventId: fixture.gateEvent.id, raisedByUserId: user.id, count: 3, at: new Date(now.getTime() - 60_000) });
    const original = (await listCurrentAnalyticsRules(session)).find((rule) => rule.code === "REPEATED_VEHICLE_EXCEPTIONS")!;
    const strict = await createAnalyticsRuleVersion(session, original.id, { minimumOccurrenceCount: 5, minimumSampleSize: 5 });
    await calculateAnalyticsForTenant(tenant.id, now);
    expect(await prisma.analyticsIndicator.count({ where: { tenantId: tenant.id, ruleCode: strict.code, subjectId: fixture.vehicle.id } })).toBe(0);

    const relaxed = await createAnalyticsRuleVersion(session, strict.id, { minimumOccurrenceCount: 3, minimumSampleSize: 3, severity: "HIGH" });
    await calculateAnalyticsForTenant(tenant.id, new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const created = await prisma.analyticsIndicator.findFirstOrThrow({ where: { tenantId: tenant.id, ruleCode: relaxed.code, subjectId: fixture.vehicle.id } });
    expect(created.ruleVersion).toBe(relaxed.version);
    expect(created.severity).toBe("HIGH");
    expect((created.ruleSnapshot as { minimumOccurrenceCount: number }).minimumOccurrenceCount).toBe(3);

    const newest = await createAnalyticsRuleVersion(session, relaxed.id, { minimumOccurrenceCount: 2, severity: "LOW" });
    await calculateAnalyticsForTenant(tenant.id, new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const stillHistorical = await prisma.analyticsIndicator.findUniqueOrThrow({ where: { id: created.id } });
    expect(stillHistorical.ruleVersion).toBe(relaxed.version);
    expect(stillHistorical.severity).toBe("HIGH");
    expect(newest.version).toBe(relaxed.version + 1);
  });

  it("labels stale mock tracking honestly and never calculates route deviation", async () => {
    const { tenant, user } = await makeAnalyticsManagerSession();
    const now = new Date("2026-08-11T15:00:00Z");
    const fixture = await createOperationalAnalyticsFixture(tenant, user.id, new Date(now.getTime() - 60_000));
    const staleAt = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    await prisma.vehicle.update({ where: { id: fixture.vehicle.id }, data: { gpsProvider: "mock", gpsDeviceReference: "mock-device", gpsStatus: "INACTIVE", gpsLastCommunicationAt: staleAt } });
    await prisma.telematicsEvent.create({ data: { tenantId: tenant.id, vehicleId: fixture.vehicle.id, source: "PROVIDER", recordedAt: staleAt, providerReference: "mock-snapshot-test" } });
    await calculateAnalyticsForTenant(tenant.id, now);
    const indicator = await prisma.analyticsIndicator.findFirstOrThrow({ where: { tenantId: tenant.id, ruleCode: "TRACKER_STALE_OR_UNAVAILABLE", subjectId: fixture.vehicle.id } });
    expect(indicator.dataQuality).toBe("MOCK");
    expect(indicator.explanation).toMatch(/data-availability condition, not evidence of misconduct/i);
    expect(JSON.stringify(indicator.supportingRecords)).toMatch(/mock provider/i);
    expect(`${indicator.title} ${indicator.explanation}`).not.toMatch(/route deviation/i);
  });

  it("never aggregates another tenant's supporting records", async () => {
    const tenantA = await createTenant("Analytics isolation A");
    const tenantB = await createTenant("Analytics isolation B");
    const { user: userA } = await makeAnalyticsManagerSessionForTenant(tenantA);
    const { user: userB } = await makeAnalyticsManagerSessionForTenant(tenantB);
    const now = new Date("2026-08-11T16:00:00Z");
    const fixtureA = await createOperationalAnalyticsFixture(tenantA, userA.id, new Date(now.getTime() - 60_000));
    const fixtureB = await createOperationalAnalyticsFixture(tenantB, userB.id, new Date(now.getTime() - 60_000));
    await createExceptionSeries({ tenantId: tenantA.id, gateEventId: fixtureA.gateEvent.id, raisedByUserId: userA.id, count: 2, at: new Date(now.getTime() - 60_000) });
    await createExceptionSeries({ tenantId: tenantB.id, gateEventId: fixtureB.gateEvent.id, raisedByUserId: userB.id, count: 8, at: new Date(now.getTime() - 60_000) });
    await calculateAnalyticsForTenant(tenantA.id, now);
    expect(await prisma.analyticsIndicator.count({ where: { tenantId: tenantA.id, ruleCode: "REPEATED_VEHICLE_EXCEPTIONS" } })).toBe(0);
    expect(await prisma.analyticsIndicator.count({ where: { tenantId: tenantB.id } })).toBe(0);
  });
});
