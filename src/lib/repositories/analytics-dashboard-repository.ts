import "server-only";
import { prisma } from "@/lib/db/prisma";
import { hasPermission, requirePermission } from "@/lib/auth/authorize";
import { localDateKey, localHourMinute, reportingRangeFromDateOnly } from "@/lib/analytics/timezone";
import { ensureDefaultAnalyticsRules } from "@/lib/repositories/analytics-rule-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { AnalyticsFilterInput } from "@/lib/validation/analytics";
import type { AnalyticsDataQuality, Prisma } from "@/generated/prisma/client";

const DASHBOARD_ROW_LIMIT = 10_000;

export class AnalyticsSupportingRecordError extends Error {
  constructor() {
    super("One or more analytics filters are not available in this company.");
    this.name = "AnalyticsSupportingRecordError";
  }
}

async function validateFilterScope(tenantId: string, filters: AnalyticsFilterInput) {
  const checks = await Promise.all([
    filters.siteId ? prisma.site.count({ where: { tenantId, id: filters.siteId } }) : 1,
    filters.gateId ? prisma.gate.count({ where: { tenantId, id: filters.gateId, ...(filters.siteId ? { siteId: filters.siteId } : {}) } }) : 1,
    filters.vehicleId ? prisma.vehicle.count({ where: { tenantId, id: filters.vehicleId } }) : 1,
    filters.driverId ? prisma.driver.count({ where: { tenantId, id: filters.driverId } }) : 1,
  ]);
  if (checks.some((count) => count !== 1)) throw new AnalyticsSupportingRecordError();
}

function average(values: number[]) {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
}

function bucket(rows: Array<{ date: Date; key: string }>, timeZone: string, kind: "day" | "week" | "month") {
  const map = new Map<string, number>();
  for (const row of rows) {
    const day = localDateKey(row.date, timeZone);
    let key = day;
    if (kind === "month") key = day.slice(0, 7);
    if (kind === "week") {
      const utc = new Date(`${day}T00:00:00Z`);
      const weekday = (utc.getUTCDay() + 6) % 7;
      utc.setUTCDate(utc.getUTCDate() - weekday);
      key = utc.toISOString().slice(0, 10);
    }
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, count]) => ({ period, count }));
}

function trackingQuality(events: Array<{ source: "PROVIDER" | "MANUAL"; providerReference: string | null }>, trackedCount: number): AnalyticsDataQuality {
  if (trackedCount === 0 || events.length === 0) return "UNAVAILABLE";
  const hasManual = events.some((event) => event.source === "MANUAL");
  const hasMock = events.some((event) => event.source === "PROVIDER" && (!event.providerReference || /mock|synthetic|demo/i.test(event.providerReference)));
  const hasUnverifiedProvider = events.some((event) => event.source === "PROVIDER" && event.providerReference && !/mock|synthetic|demo/i.test(event.providerReference));
  if ([hasManual, hasMock, hasUnverifiedProvider].filter(Boolean).length > 1) return "MIXED";
  if (hasManual) return "MANUAL";
  if (hasMock) return "MOCK";
  // Phase 12 has no production provider credentials. Do not call this live.
  return "INCOMPLETE";
}

export async function getGovernanceAnalyticsDashboard(session: AuthenticatedSession, filters: AnalyticsFilterInput = {}, now = new Date()) {
  await requirePermission(session, "governanceAnalytics", "VIEW");
  await validateFilterScope(session.tenantId, filters);
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { id: true, name: true, timezone: true } });
  if (!tenant) throw new AnalyticsSupportingRecordError();
  const period = reportingRangeFromDateOnly(filters.startDate, filters.endDate, tenant.timezone, now);
  await ensureDefaultAnalyticsRules(session.tenantId);

  const movementWhere: Prisma.MovementAuthorisationWhereInput = {
    tenantId: session.tenantId,
    createdAt: { gte: period.start, lt: period.endExclusive },
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    ...(filters.driverId ? { driverId: filters.driverId } : {}),
    ...(filters.movementType ? { movementType: filters.movementType } : {}),
    ...(filters.department ? { driver: { department: filters.department } } : {}),
  };
  const gateWhere: Prisma.GateEventWhereInput = {
    tenantId: session.tenantId,
    createdAt: { gte: period.start, lt: period.endExclusive },
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
    ...(filters.gateId ? { gateId: filters.gateId } : {}),
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    ...(filters.driverId ? { driverId: filters.driverId } : {}),
    ...(filters.department ? { driver: { department: filters.department } } : {}),
  };
  const exceptionAnd: Prisma.ExceptionWhereInput[] = [];
  if (filters.siteId || filters.gateId || filters.driverId || filters.department) {
    exceptionAnd.push({ gateEvent: {
      ...(filters.siteId ? { siteId: filters.siteId } : {}),
      ...(filters.gateId ? { gateId: filters.gateId } : {}),
      ...(filters.driverId ? { driverId: filters.driverId } : {}),
      ...(filters.department ? { driver: { department: filters.department } } : {}),
    } });
  }
  if (filters.vehicleId) exceptionAnd.push({ OR: [{ vehicleId: filters.vehicleId }, { gateEvent: { vehicleId: filters.vehicleId } }] });
  const exceptionWhere: Prisma.ExceptionWhereInput = {
    tenantId: session.tenantId,
    raisedAt: { gte: period.start, lt: period.endExclusive },
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.exceptionStatus === "OPEN" ? { resolvedAt: null } : filters.exceptionStatus === "RESOLVED" ? { resolvedAt: { not: null } } : {}),
    ...(exceptionAnd.length ? { AND: exceptionAnd } : {}),
  };
  const investigationWhere: Prisma.InvestigationCaseWhereInput = {
    tenantId: session.tenantId,
    createdAt: { gte: period.start, lt: period.endExclusive },
    ...(filters.investigationStatus ? { status: filters.investigationStatus } : {}),
    ...(filters.severity ? { priority: filters.severity } : {}),
    ...(filters.vehicleId ? { subjects: { some: { vehicleId: filters.vehicleId } } } : {}),
    ...(filters.driverId ? { subjects: { some: { driverId: filters.driverId } } } : {}),
    ...(filters.department ? { subjects: { some: { department: filters.department } } } : {}),
  };

  const [movementsRaw, gateEventsRaw, inspectionRaw, exceptionsRaw, reconciliationsRaw, investigationCasesRaw, overdueTasks, activeHolds, indicators, latestCalculation, trackedVehicles, trackingEvents, externalGrants, findingApprovals, canExport, canCalculate, canReview, canConfigure] = await Promise.all([
    prisma.movementAuthorisation.findMany({ where: movementWhere, select: { id: true, status: true, movementType: true, createdAt: true, updatedAt: true, expectedDepartureAt: true, expectedReturnAt: true, vehicleId: true, driverId: true, reconciliation: { select: { id: true } }, gateEvents: { select: { startedAt: true, completedAt: true }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.gateEvent.findMany({ where: gateWhere, select: { id: true, createdAt: true, direction: true, status: true, startedAt: true, completedAt: true, decision: true, vehicleId: true, driverId: true, siteId: true, gateId: true }, orderBy: { createdAt: "desc" }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.gateEventInspectionItem.findMany({ where: { tenantId: session.tenantId, recordedAt: { gte: period.start, lt: period.endExclusive }, gateEvent: gateWhere }, select: { id: true, outcome: true, recordedAt: true, inspectionItem: { select: { section: true } } }, orderBy: { recordedAt: "desc" }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.exception.findMany({ where: exceptionWhere, select: { id: true, severity: true, raisedAt: true, resolvedAt: true, vehicleId: true, gateEvent: { select: { id: true, vehicleId: true, driverId: true, siteId: true, gateId: true } } }, orderBy: { raisedAt: "desc" }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.reconciliation.findMany({ where: { tenantId: session.tenantId, createdAt: { gte: period.start, lt: period.endExclusive }, ...(filters.vehicleId || filters.driverId || filters.siteId || filters.movementType || filters.department ? { movementAuthorisation: { ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}), ...(filters.driverId ? { driverId: filters.driverId } : {}), ...(filters.siteId ? { siteId: filters.siteId } : {}), ...(filters.movementType ? { movementType: filters.movementType } : {}), ...(filters.department ? { driver: { department: filters.department } } : {}) } } : {}) }, select: { id: true, createdAt: true, kmTravelled: true, discrepancies: { select: { id: true, category: true, severity: true, status: true } } }, orderBy: { createdAt: "desc" }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.investigationCase.findMany({ where: investigationWhere, select: { id: true, source: true, category: true, priority: true, status: true, outcome: true, createdAt: true, submittedAt: true, triagedAt: true, closedAt: true, reopenedAt: true }, orderBy: { createdAt: "desc" }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.investigationTask.count({ where: { tenantId: session.tenantId, dueDate: { lt: now }, status: { in: ["OPEN", "IN_PROGRESS"] }, case: { ...(filters.investigationStatus ? { status: filters.investigationStatus } : {}) } } }),
    prisma.investigationCase.count({ where: { tenantId: session.tenantId, evidenceHoldActive: true } }),
    prisma.analyticsIndicator.findMany({ where: { tenantId: session.tenantId, lastDetectedAt: { gte: period.start, lt: period.endExclusive }, ...(filters.severity ? { severity: filters.severity } : {}), ...(filters.vehicleId ? { subjectType: "VEHICLE", subjectId: filters.vehicleId } : filters.driverId ? { subjectType: "DRIVER", subjectId: filters.driverId } : filters.gateId ? { subjectType: "GATE", subjectId: filters.gateId } : filters.siteId ? { subjectType: "SITE", subjectId: filters.siteId } : {}) }, select: { id: true, title: true, explanation: true, severity: true, status: true, subjectType: true, subjectLabel: true, occurrenceCount: true, dataQuality: true, lastDetectedAt: true }, orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }], take: 100 }),
    prisma.analyticsCalculationRun.findFirst({ where: { tenantId: session.tenantId }, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true, dataQuality: true, errorMessage: true } }),
    prisma.vehicle.findMany({ where: { tenantId: session.tenantId, archivedAt: null, ...(filters.vehicleId ? { id: filters.vehicleId } : {}), OR: [{ gpsDeviceReference: { not: null } }, { gpsProvider: { not: null } }] }, select: { id: true, gpsStatus: true, gpsLastCommunicationAt: true }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.telematicsEvent.findMany({ where: { tenantId: session.tenantId, recordedAt: { gte: period.start, lt: period.endExclusive }, ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}) }, distinct: ["vehicleId"], orderBy: [{ vehicleId: "asc" }, { recordedAt: "desc" }], select: { vehicleId: true, recordedAt: true, source: true, providerReference: true }, take: DASHBOARD_ROW_LIMIT + 1 }),
    prisma.externalAuditorAccessGrant.findMany({ where: { tenantId: session.tenantId, createdAt: { gte: period.start, lt: period.endExclusive } }, select: { createdAt: true, expiresAt: true, revokedAt: true } }),
    prisma.investigationApproval.findMany({ where: { tenantId: session.tenantId, createdAt: { gte: period.start, lt: period.endExclusive } }, select: { action: true } }),
    hasPermission(session, "analyticsExport", "EXPORT"),
    hasPermission(session, "analyticsIndicator", "CREATE"),
    hasPermission(session, "analyticsIndicator", "EDIT"),
    hasPermission(session, "analyticsRule", "CONFIGURE"),
  ]);

  const truncated = [movementsRaw, gateEventsRaw, inspectionRaw, exceptionsRaw, reconciliationsRaw, investigationCasesRaw, trackedVehicles, trackingEvents].some((rows) => rows.length > DASHBOARD_ROW_LIMIT);
  const movements = movementsRaw.slice(0, DASHBOARD_ROW_LIMIT);
  const gateEvents = gateEventsRaw.slice(0, DASHBOARD_ROW_LIMIT);
  const inspections = inspectionRaw.slice(0, DASHBOARD_ROW_LIMIT);
  const exceptions = exceptionsRaw.slice(0, DASHBOARD_ROW_LIMIT);
  const reconciliations = reconciliationsRaw.slice(0, DASHBOARD_ROW_LIMIT);
  const investigationCases = investigationCasesRaw.slice(0, DASHBOARD_ROW_LIMIT);
  const tracked = trackedVehicles.slice(0, DASHBOARD_ROW_LIMIT);
  const tracking = trackingEvents.slice(0, DASHBOARD_ROW_LIMIT);

  const gateProcessingMinutes = gateEvents.filter((row) => row.startedAt && row.completedAt).map((row) => (row.completedAt!.getTime() - row.startedAt!.getTime()) / 60_000).filter((value) => value >= 0);
  const movementDurationsHours = movements.flatMap((movement) => {
    const completed = movement.gateEvents.filter((event) => event.completedAt).map((event) => event.completedAt!).sort((a, b) => a.getTime() - b.getTime());
    return completed.length >= 2 ? [(completed.at(-1)!.getTime() - completed[0].getTime()) / 3_600_000] : [];
  });
  const lateDepartures = movements.filter((movement) => movement.expectedDepartureAt && movement.gateEvents[0]?.startedAt && movement.gateEvents[0].startedAt > movement.expectedDepartureAt).length;
  const lateReturns = movements.filter((movement) => movement.expectedReturnAt && movement.gateEvents.some((event) => event.completedAt && event.completedAt > movement.expectedReturnAt!)).length;
  const outsideHours = gateEvents.filter((event) => {
    const time = localHourMinute(event.createdAt, tenant.timezone);
    return time < "06:00" || time >= "20:00";
  }).length;
  const failureByCategory = new Map<string, number>();
  for (const item of inspections.filter((item) => item.outcome === "FAIL")) failureByCategory.set(item.inspectionItem.section, (failureByCategory.get(item.inspectionItem.section) ?? 0) + 1);
  const discrepancyByCategory = new Map<string, number>();
  for (const discrepancy of reconciliations.flatMap((row) => row.discrepancies)) discrepancyByCategory.set(discrepancy.category, (discrepancyByCategory.get(discrepancy.category) ?? 0) + 1);
  const exceptionVehicleCounts = new Map<string, number>();
  const exceptionDriverCounts = new Map<string, number>();
  for (const item of exceptions) {
    const vehicleId = item.vehicleId ?? item.gateEvent?.vehicleId;
    if (vehicleId) exceptionVehicleCounts.set(vehicleId, (exceptionVehicleCounts.get(vehicleId) ?? 0) + 1);
    if (item.gateEvent?.driverId) exceptionDriverCounts.set(item.gateEvent.driverId, (exceptionDriverCounts.get(item.gateEvent.driverId) ?? 0) + 1);
  }

  const investigationGroup = <T extends string | null>(selector: (row: (typeof investigationCases)[number]) => T) => {
    const result: Record<string, number> = {};
    for (const item of investigationCases) {
      const key = selector(item) ?? "UNSPECIFIED";
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  };
  const closureDays = investigationCases.filter((item) => item.closedAt).map((item) => (item.closedAt!.getTime() - item.createdAt.getTime()) / 86_400_000);
  const submissionDays = investigationCases.filter((item) => item.submittedAt).map((item) => (item.submittedAt!.getTime() - item.createdAt.getTime()) / 86_400_000);
  const triageDays = investigationCases.filter((item) => item.submittedAt && item.triagedAt).map((item) => (item.triagedAt!.getTime() - item.submittedAt!.getTime()) / 86_400_000);
  const investigationDays = investigationCases.filter((item) => item.triagedAt && item.closedAt).map((item) => (item.closedAt!.getTime() - item.triagedAt!.getTime()) / 86_400_000);
  const quality = trackingQuality(tracking, tracked.length);

  return {
    tenant: { id: tenant.id, name: tenant.name, timezone: tenant.timezone },
    period: { startDate: period.startDate, endDate: period.endDate, startUtc: period.start, endExclusiveUtc: period.endExclusive },
    filters,
    capabilities: { canExport, canCalculate, canReview, canConfigure },
    calculation: latestCalculation,
    dataQuality: {
      status: truncated ? "INCOMPLETE" : quality,
      queryTruncated: truncated,
      rowLimit: DASHBOARD_ROW_LIMIT,
      statement: truncated
        ? `At least one bounded analytics query reached ${DASHBOARD_ROW_LIMIT} records; totals shown for that source are incomplete.`
        : quality === "MOCK"
          ? "Tracking summaries use clearly labelled mock provider data. Operational database records are real local application records."
          : quality === "UNAVAILABLE"
            ? "Tracking information is unavailable for this period. No route-deviation conclusion was calculated."
            : "Metrics were calculated from the tenant-scoped records available for this reporting period.",
    },
    executive: {
      totalAuthorisedMovements: movements.length,
      completedMovements: movements.filter((item) => item.status === "COMPLETED").length,
      openOrOverdueMovements: movements.filter((item) => !["COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"].includes(item.status) || (item.expectedReturnAt != null && item.expectedReturnAt < now && item.status !== "COMPLETED")).length,
      gateEntries: gateEvents.filter((item) => item.direction === "ENTRY").length,
      gateExits: gateEvents.filter((item) => item.direction === "EXIT").length,
      inspectionPasses: inspections.filter((item) => item.outcome === "PASS").length,
      inspectionFailures: inspections.filter((item) => item.outcome === "FAIL").length,
      openGovernanceExceptions: exceptions.filter((item) => !item.resolvedAt).length,
      criticalAndHighExceptions: exceptions.filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH").length,
      reconciliationDiscrepancies: reconciliations.reduce((sum, item) => sum + item.discrepancies.length, 0),
      vehiclesWithRepeatedExceptions: [...exceptionVehicleCounts.values()].filter((count) => count >= 3).length,
      driversWithRepeatedReviewIndicators: [...exceptionDriverCounts.values()].filter((count) => count >= 3).length,
      sitesOrGatesWithUnusualActivity: indicators.filter((item) => item.subjectType === "SITE" || item.subjectType === "GATE").length,
      openInvestigations: investigationCases.filter((item) => item.status !== "CLOSED").length,
      overdueInvestigationTasks: overdueTasks,
      evidenceUnderActiveHold: activeHolds,
      trackerDataAvailability: quality,
      latestAnalyticsCalculationTime: latestCalculation?.finishedAt ?? latestCalculation?.startedAt ?? null,
    },
    operational: {
      movementsByDay: bucket(movements.map((item) => ({ date: item.createdAt, key: item.id })), tenant.timezone, "day"),
      movementsByWeek: bucket(movements.map((item) => ({ date: item.createdAt, key: item.id })), tenant.timezone, "week"),
      movementsByMonth: bucket(movements.map((item) => ({ date: item.createdAt, key: item.id })), tenant.timezone, "month"),
      gateVolumesByDay: bucket(gateEvents.map((item) => ({ date: item.createdAt, key: item.id })), tenant.timezone, "day"),
      averageGateProcessingMinutes: average(gateProcessingMinutes),
      averageInspectionMinutes: null,
      inspectionTimingStatement: "Inspection duration is unavailable because inspection items record outcomes but not a distinct inspection start time. Gate processing time is reported separately and is not presented as inspection time.",
      averageMovementDurationHours: average(movementDurationsHours),
      lateDepartures,
      lateReturns,
      vehiclesCurrentlyOutsideSite: new Set(movements.filter((item) => item.status === "IN_PROGRESS").map((item) => item.vehicleId)).size,
      missingReturnReconciliations: movements.filter((item) => item.status === "COMPLETED" && !item.reconciliation).length,
      inspectionFailuresByCategory: [...failureByCategory.entries()].map(([category, count]) => ({ category, count })),
      discrepanciesByCategory: [...discrepancyByCategory.entries()].map(([category, count]) => ({ category, count })),
      gateOverridesAndDeniedMovements: gateEvents.filter((item) => item.decision === "DENIED").length + gateEvents.filter((item) => item.decision === "CLEARED" && exceptions.some((exception) => exception.gateEvent?.id === item.id)).length,
      activityOutsideExpectedHours: outsideHours,
    },
    investigations: {
      bySource: investigationGroup((item) => item.source),
      byCategory: investigationGroup((item) => item.category),
      byPriority: investigationGroup((item) => item.priority),
      byStatus: investigationGroup((item) => item.status),
      byOutcome: investigationGroup((item) => item.outcome),
      averageDaysToSubmission: average(submissionDays),
      averageDaysFromSubmissionToTriage: average(triageDays),
      averageDaysFromTriageToClosure: average(investigationDays),
      averageDaysToClosure: average(closureDays),
      reopenedCases: investigationCases.filter((item) => item.reopenedAt).length,
      overdueTasks,
      findingsReturnedForAmendment: findingApprovals.filter((item) => item.action === "RETURN_FOR_AMENDMENT").length,
      findingApprovals: findingApprovals.filter((item) => item.action === "APPROVE").length,
      findingRejections: findingApprovals.filter((item) => item.action === "REJECT").length,
      externalAuditorGrantsIssued: externalGrants.length,
      externalAuditorGrantsExpired: externalGrants.filter((item) => item.expiresAt < now && !item.revokedAt).length,
      externalAuditorGrantsRevoked: externalGrants.filter((item) => item.revokedAt).length,
      activeEvidenceHolds: activeHolds,
      confidentialityStatement: "Investigation analytics are aggregated. Case titles, allegations, subject identities, notes, evidence, and confidential narratives are not included.",
    },
    tracking: {
      dataQuality: quality,
      trackedVehicleCount: tracked.length,
      activeCount: tracked.filter((item) => item.gpsStatus === "ACTIVE").length,
      staleOrUnavailableCount: tracked.filter((item) => item.gpsStatus !== "ACTIVE" || !item.gpsLastCommunicationAt).length,
      latestTrackingTimestamp: tracking.map((item) => item.recordedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      sourceLabels: [...new Set(tracking.map((item) => item.source === "MANUAL" ? "MANUAL" : !item.providerReference || /mock|synthetic|demo/i.test(item.providerReference) ? "MOCK" : "UNVERIFIED_PROVIDER"))],
      limitation: "No production tracker provider is connected. Route deviation is not calculated when route or GPS information is insufficient, and unavailable tracking is never treated as proof of misconduct.",
    },
    indicators,
  };
}

export { DASHBOARD_ROW_LIMIT };
