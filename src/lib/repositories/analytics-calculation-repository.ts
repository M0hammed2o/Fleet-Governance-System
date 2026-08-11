import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { localDateKey, localHourMinute, reportingRangeFromDateOnly, subtractDays, subtractTenantCalendarDays } from "@/lib/analytics/timezone";
import { ensureDefaultAnalyticsRules, snapshotAnalyticsRule } from "@/lib/repositories/analytics-rule-repository";
import type {
  AnalyticsDataQuality,
  AnalyticsRule,
  AnalyticsSubjectType,
  Prisma,
} from "@/generated/prisma/client";

const QUERY_ROW_LIMIT = 10_000;
const SUPPORTING_RECORD_LIMIT = 50;
const JOB_TENANT_LIMIT = 1_000;

type SupportingRecord = {
  type: string;
  id: string;
  occurredAt: string;
  summary: string;
};

type Candidate = {
  rule: AnalyticsRule;
  subjectType: AnalyticsSubjectType;
  subjectId: string;
  subjectLabel: string;
  occurrenceCount: number;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  title: string;
  explanation: string;
  recommendedAction: string;
  supportingRecords: SupportingRecord[];
  dataQuality: AnalyticsDataQuality;
};

type GroupEntry = { id: string; label: string; occurredAt: Date; record: SupportingRecord };

function groupEntries(entries: GroupEntry[]) {
  const groups = new Map<string, { label: string; entries: GroupEntry[] }>();
  for (const entry of entries) {
    const existing = groups.get(entry.id) ?? { label: entry.label, entries: [] };
    existing.entries.push(entry);
    groups.set(entry.id, existing);
  }
  return groups;
}

function recordBounds(entries: GroupEntry[]) {
  const ordered = [...entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return {
    first: ordered[0]?.occurredAt ?? new Date(),
    last: ordered.at(-1)?.occurredAt ?? new Date(),
    records: ordered.slice(-SUPPORTING_RECORD_LIMIT).map((entry) => entry.record),
  };
}

function within(date: Date, start: Date, end: Date) {
  return date >= start && date < end;
}

function isP2002(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function worstDataQuality(values: AnalyticsDataQuality[]): AnalyticsDataQuality {
  const rank: Record<AnalyticsDataQuality, number> = { COMPLETE: 0, MANUAL: 1, MOCK: 2, MIXED: 3, INCOMPLETE: 4, UNAVAILABLE: 5 };
  return values.reduce((worst, value) => (rank[value] > rank[worst] ? value : worst), "COMPLETE" as AnalyticsDataQuality);
}

function trackerQuality(providerReference: string | null, source: "PROVIDER" | "MANUAL" | null): AnalyticsDataQuality {
  if (!source) return "UNAVAILABLE";
  if (source === "MANUAL") return "MANUAL";
  if (!providerReference || /mock|synthetic|demo/i.test(providerReference)) return "MOCK";
  // No production provider is configured in Phase 12. A non-mock provider
  // reference is therefore still incomplete rather than represented as live.
  return "INCOMPLETE";
}

function candidateForGroups(input: {
  rule: AnalyticsRule;
  groups: Map<string, { label: string; entries: GroupEntry[] }>;
  subjectType: AnalyticsSubjectType;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  condition: string;
  quality?: AnalyticsDataQuality;
}): Candidate[] {
  const result: Candidate[] = [];
  for (const [subjectId, group] of input.groups) {
    if (group.entries.length < input.rule.minimumOccurrenceCount || group.entries.length < input.rule.minimumSampleSize) continue;
    const bounds = recordBounds(group.entries);
    result.push({
      rule: input.rule,
      subjectType: input.subjectType,
      subjectId,
      subjectLabel: group.label,
      occurrenceCount: group.entries.length,
      firstDetectedAt: bounds.first,
      lastDetectedAt: bounds.last,
      title: input.title,
      explanation: `${group.entries.length} records met the condition “${input.condition}” between ${input.periodStart.toISOString()} and ${input.periodEnd.toISOString()}. The configured minimum was ${input.rule.minimumOccurrenceCount}.`,
      recommendedAction: "Review the supporting operational records and document whether the pattern is expected, explained, or requires further governance review.",
      supportingRecords: bounds.records,
      dataQuality: input.quality ?? "COMPLETE",
    });
  }
  return result;
}

async function buildCandidates(tenantId: string, rules: AnalyticsRule[], evaluationEnd: Date, timezone: string) {
  const maximumDays = Math.max(...rules.map((rule) => rule.evaluationPeriodDays + (rule.baselinePeriodDays ?? 0)), 1);
  const historyStart = subtractTenantCalendarDays(evaluationEnd, maximumDays, timezone);
  const [exceptions, failures, completedGateEvents, completedMovements, discrepancies, vehicles] = await Promise.all([
    prisma.exception.findMany({
      where: { tenantId, raisedAt: { gte: historyStart, lt: evaluationEnd } },
      select: {
        id: true,
        raisedAt: true,
        severity: true,
        description: true,
        vehicle: { select: { id: true, registrationNumber: true } },
        gateEvent: { select: { vehicle: { select: { id: true, registrationNumber: true } }, driver: { select: { id: true, name: true } }, site: { select: { id: true, name: true } }, gate: { select: { id: true, name: true } }, decision: true } },
      },
      orderBy: { raisedAt: "desc" },
      take: QUERY_ROW_LIMIT + 1,
    }),
    prisma.gateEventInspectionItem.findMany({
      where: { tenantId, outcome: "FAIL", recordedAt: { gte: historyStart, lt: evaluationEnd } },
      select: { id: true, recordedAt: true, inspectionItem: { select: { label: true, section: true } }, gateEvent: { select: { vehicle: { select: { id: true, registrationNumber: true } } } } },
      orderBy: { recordedAt: "desc" },
      take: QUERY_ROW_LIMIT + 1,
    }),
    prisma.gateEvent.findMany({
      where: { tenantId, completedAt: { gte: historyStart, lt: evaluationEnd } },
      select: {
        id: true,
        completedAt: true,
        decision: true,
        vehicle: { select: { id: true, registrationNumber: true } },
        _count: { select: { exceptions: true } },
      },
      orderBy: { completedAt: "desc" },
      take: QUERY_ROW_LIMIT + 1,
    }),
    prisma.movementAuthorisation.findMany({
      where: { tenantId, status: "COMPLETED", updatedAt: { gte: historyStart, lt: evaluationEnd } },
      select: { id: true, updatedAt: true, expectedReturnAt: true, vehicle: { select: { id: true, registrationNumber: true } }, reconciliation: { select: { id: true } }, gateEvents: { where: { completedAt: { not: null } }, select: { completedAt: true }, orderBy: { completedAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
      take: QUERY_ROW_LIMIT + 1,
    }),
    prisma.reconciliationDiscrepancy.findMany({
      where: { tenantId, createdAt: { gte: historyStart, lt: evaluationEnd } },
      select: {
        id: true,
        createdAt: true,
        category: true,
        description: true,
        reconciliation: { select: { movementAuthorisation: { select: { vehicle: { select: { id: true, registrationNumber: true } } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: QUERY_ROW_LIMIT + 1,
    }),
    prisma.vehicle.findMany({
      where: { tenantId, archivedAt: null },
      select: {
        id: true,
        registrationNumber: true,
        gpsDeviceReference: true,
        gpsProvider: true,
        gpsLastCommunicationAt: true,
        gpsStatus: true,
        telematicsEvents: { orderBy: { recordedAt: "desc" }, take: 1, select: { id: true, recordedAt: true, source: true, providerReference: true } },
      },
      orderBy: { id: "asc" },
      take: QUERY_ROW_LIMIT + 1,
    }),
  ]);

  const truncated = [exceptions, failures, completedGateEvents, completedMovements, discrepancies, vehicles].some((rows) => rows.length > QUERY_ROW_LIMIT);
  const clippedExceptions = exceptions.slice(0, QUERY_ROW_LIMIT);
  const clippedFailures = failures.slice(0, QUERY_ROW_LIMIT);
  const clippedGateEvents = completedGateEvents.slice(0, QUERY_ROW_LIMIT);
  const clippedMovements = completedMovements.slice(0, QUERY_ROW_LIMIT);
  const clippedDiscrepancies = discrepancies.slice(0, QUERY_ROW_LIMIT);
  const clippedVehicles = vehicles.slice(0, QUERY_ROW_LIMIT);
  const candidates: Candidate[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const periodStart = subtractTenantCalendarDays(evaluationEnd, rule.evaluationPeriodDays, timezone);
    if (rule.code === "REPEATED_VEHICLE_EXCEPTIONS" || rule.code === "REPEATED_DRIVER_EXCEPTIONS" || rule.code === "SITE_EXCEPTION_CONCENTRATION") {
      const subjectType: AnalyticsSubjectType = rule.code === "REPEATED_VEHICLE_EXCEPTIONS" ? "VEHICLE" : rule.code === "REPEATED_DRIVER_EXCEPTIONS" ? "DRIVER" : "SITE";
      const entries = clippedExceptions.filter((row) => within(row.raisedAt, periodStart, evaluationEnd)).flatMap((row): GroupEntry[] => {
        const subject = subjectType === "VEHICLE" ? (row.vehicle ?? row.gateEvent?.vehicle) : subjectType === "DRIVER" ? row.gateEvent?.driver : row.gateEvent?.site;
        if (!subject) return [];
        const label = "registrationNumber" in subject ? subject.registrationNumber : subject.name;
        return [{ id: subject.id, label, occurredAt: row.raisedAt, record: { type: "EXCEPTION", id: row.id, occurredAt: row.raisedAt.toISOString(), summary: `${row.severity} governance exception` } }];
      });
      candidates.push(...candidateForGroups({
        rule,
        groups: groupEntries(entries),
        subjectType,
        title: subjectType === "SITE" ? "Site exception concentration requires review" : `Repeated ${subjectType.toLowerCase()} exceptions require review`,
        periodStart,
        periodEnd: evaluationEnd,
        condition: "a governance exception was recorded for the same subject",
        quality: truncated ? "INCOMPLETE" : "COMPLETE",
      }));
    }

    if (rule.code === "REPEATED_INSPECTION_FAILURES") {
      const entries = clippedFailures.filter((row) => within(row.recordedAt, periodStart, evaluationEnd)).map((row) => ({
        id: row.gateEvent.vehicle.id,
        label: row.gateEvent.vehicle.registrationNumber,
        occurredAt: row.recordedAt,
        record: { type: "INSPECTION_ITEM", id: row.id, occurredAt: row.recordedAt.toISOString(), summary: `Failed ${row.inspectionItem.section}: ${row.inspectionItem.label}` },
      }));
      candidates.push(...candidateForGroups({ rule, groups: groupEntries(entries), subjectType: "VEHICLE", title: "Repeated inspection failures require review", periodStart, periodEnd: evaluationEnd, condition: "an inspection answer was recorded as failed", quality: truncated ? "INCOMPLETE" : "COMPLETE" }));
    }

    if (rule.code === "REPEATED_GATE_OVERRIDES") {
      const entries = clippedGateEvents.filter((row) => row.completedAt && within(row.completedAt, periodStart, evaluationEnd) && row.decision === "CLEARED" && row._count.exceptions > 0).map((row) => ({
        id: row.vehicle.id,
        label: row.vehicle.registrationNumber,
        occurredAt: row.completedAt!,
        record: { type: "GATE_EVENT", id: row.id, occurredAt: row.completedAt!.toISOString(), summary: `Cleared gate event with ${row._count.exceptions} recorded exception(s)` },
      }));
      candidates.push(...candidateForGroups({ rule, groups: groupEntries(entries), subjectType: "VEHICLE", title: "Repeated gate clearances with exceptions require review", periodStart, periodEnd: evaluationEnd, condition: "a gate event was cleared while one or more exceptions were recorded", quality: truncated ? "INCOMPLETE" : "COMPLETE" }));
    }

    if (rule.code === "REPEATED_LATE_RETURNS") {
      const entries = clippedMovements.flatMap((row): GroupEntry[] => {
        const returnedAt = row.gateEvents.at(-1)?.completedAt;
        if (!returnedAt || !row.expectedReturnAt || !within(returnedAt, periodStart, evaluationEnd) || returnedAt <= row.expectedReturnAt) return [];
        return [{ id: row.vehicle.id, label: row.vehicle.registrationNumber, occurredAt: returnedAt, record: { type: "MOVEMENT", id: row.id, occurredAt: returnedAt.toISOString(), summary: "Final completed gate event occurred after the authorised expected return time" } }];
      });
      candidates.push(...candidateForGroups({ rule, groups: groupEntries(entries), subjectType: "VEHICLE", title: "Repeated late returns require review", periodStart, periodEnd: evaluationEnd, condition: "the completed return occurred after the authorised expected return time", quality: truncated ? "INCOMPLETE" : "COMPLETE" }));
    }

    if (rule.code === "UNUSUALLY_LONG_MOVEMENTS") {
      const thresholdHours = rule.numericThreshold ?? 24;
      const entries = clippedMovements.flatMap((row): GroupEntry[] => {
        const completed = row.gateEvents.flatMap((event) => event.completedAt ? [event.completedAt] : []);
        if (completed.length < 2) return [];
        const first = completed[0];
        const last = completed.at(-1)!;
        const durationHours = (last.getTime() - first.getTime()) / 3_600_000;
        if (!within(last, periodStart, evaluationEnd) || durationHours <= thresholdHours) return [];
        return [{
          id: row.vehicle.id,
          label: row.vehicle.registrationNumber,
          occurredAt: last,
          record: { type: "MOVEMENT", id: row.id, occurredAt: last.toISOString(), summary: `Movement duration of ${durationHours.toFixed(1)} hours exceeded the configured ${thresholdHours}-hour threshold` },
        }];
      });
      candidates.push(...candidateForGroups({ rule, groups: groupEntries(entries), subjectType: "VEHICLE", title: "Unusually long movement durations require review", periodStart, periodEnd: evaluationEnd, condition: `elapsed time between the movement's first and last completed gate events exceeded ${thresholdHours} hours`, quality: truncated ? "INCOMPLETE" : "COMPLETE" }));
    }

    if (rule.code === "MISSING_RETURN_RECONCILIATIONS") {
      const entries = clippedMovements.filter((row) => !row.reconciliation && within(row.updatedAt, periodStart, evaluationEnd)).map((row) => ({
        id: row.vehicle.id,
        label: row.vehicle.registrationNumber,
        occurredAt: row.updatedAt,
        record: { type: "MOVEMENT", id: row.id, occurredAt: row.updatedAt.toISOString(), summary: "Completed movement has no return reconciliation" },
      }));
      candidates.push(...candidateForGroups({ rule, groups: groupEntries(entries), subjectType: "VEHICLE", title: "Missing return reconciliations require review", periodStart, periodEnd: evaluationEnd, condition: "a completed movement had no return reconciliation", quality: truncated ? "INCOMPLETE" : "COMPLETE" }));
    }

    if (rule.code === "REPEATED_DATA_INCONSISTENCIES") {
      const entries = clippedDiscrepancies.filter((row) => within(row.createdAt, periodStart, evaluationEnd)).map((row) => ({
        id: row.reconciliation.movementAuthorisation.vehicle.id,
        label: row.reconciliation.movementAuthorisation.vehicle.registrationNumber,
        occurredAt: row.createdAt,
        record: { type: "RECONCILIATION_DISCREPANCY", id: row.id, occurredAt: row.createdAt.toISOString(), summary: `${row.category.replaceAll("_", " ")} data inconsistency` },
      }));
      candidates.push(...candidateForGroups({ rule, groups: groupEntries(entries), subjectType: "VEHICLE", title: "Repeated data inconsistencies require review", periodStart, periodEnd: evaluationEnd, condition: "a reconciliation discrepancy was recorded", quality: truncated ? "INCOMPLETE" : "COMPLETE" }));
    }

    if (rule.code === "TRACKER_STALE_OR_UNAVAILABLE") {
      const staleHours = rule.staleDataHours ?? 24;
      const staleBefore = new Date(evaluationEnd.getTime() - staleHours * 3_600_000);
      for (const vehicle of clippedVehicles) {
        if (!vehicle.gpsDeviceReference && !vehicle.gpsProvider) continue;
        const latest = vehicle.telematicsEvents[0] ?? null;
        const lastCommunication = vehicle.gpsLastCommunicationAt ?? latest?.recordedAt ?? null;
        if (vehicle.gpsStatus === "ACTIVE" && lastCommunication && lastCommunication >= staleBefore) continue;
        const quality = trackerQuality(latest?.providerReference ?? null, latest?.source ?? null);
        const occurredAt = lastCommunication ?? evaluationEnd;
        candidates.push({
          rule,
          subjectType: "VEHICLE",
          subjectId: vehicle.id,
          subjectLabel: vehicle.registrationNumber,
          occurrenceCount: 1,
          firstDetectedAt: occurredAt,
          lastDetectedAt: occurredAt,
          title: "Tracking information is stale or unavailable",
          explanation: `The latest tracking timestamp was ${lastCommunication?.toISOString() ?? "unavailable"}. The configured stale-data threshold was ${staleHours} hours. This is a data-availability condition, not evidence of misconduct.`,
          recommendedAction: "Confirm the tracker mapping, provider availability, or an authorised manual location record before drawing any operational conclusion.",
          supportingRecords: latest ? [{ type: "TELEMATICS_EVENT", id: latest.id, occurredAt: latest.recordedAt.toISOString(), summary: `Source: ${quality === "MOCK" ? "mock provider" : latest.source.toLowerCase()}` }] : [],
          dataQuality: quality,
        });
      }
    }

    if (rule.code === "OUTSIDE_EXPECTED_OPERATING_HOURS") {
      const start = rule.operatingHourStart ?? "06:00";
      const end = rule.operatingHourEnd ?? "20:00";
      const entries = clippedGateEvents.filter((row) => {
        if (!row.completedAt || !within(row.completedAt, periodStart, evaluationEnd)) return false;
        const time = localHourMinute(row.completedAt, timezone);
        return start <= end ? time < start || time >= end : time >= end && time < start;
      }).map((row) => ({
        id: row.vehicle.id,
        label: row.vehicle.registrationNumber,
        occurredAt: row.completedAt!,
        record: { type: "GATE_EVENT", id: row.id, occurredAt: row.completedAt!.toISOString(), summary: `Gate activity outside ${start}–${end} tenant-local review hours` },
      }));
      candidates.push(...candidateForGroups({ rule, groups: groupEntries(entries), subjectType: "VEHICLE", title: "Repeated activity outside expected operating hours requires review", periodStart, periodEnd: evaluationEnd, condition: `gate activity occurred outside ${start}–${end} in the tenant time zone`, quality: truncated ? "INCOMPLETE" : "COMPLETE" }));
    }

    if (rule.code === "SUDDEN_EXCEPTION_INCREASE") {
      const baselineDays = rule.baselinePeriodDays ?? rule.evaluationPeriodDays;
      const baselineStart = subtractTenantCalendarDays(periodStart, baselineDays, timezone);
      const threshold = rule.percentageThreshold ?? 100;
      const current = groupEntries(clippedExceptions.filter((row) => within(row.raisedAt, periodStart, evaluationEnd)).flatMap((row): GroupEntry[] => {
        const vehicle = row.vehicle ?? row.gateEvent?.vehicle;
        return vehicle ? [{ id: vehicle.id, label: vehicle.registrationNumber, occurredAt: row.raisedAt, record: { type: "EXCEPTION", id: row.id, occurredAt: row.raisedAt.toISOString(), summary: `${row.severity} governance exception` } }] : [];
      }));
      const baseline = groupEntries(clippedExceptions.filter((row) => within(row.raisedAt, baselineStart, periodStart)).flatMap((row): GroupEntry[] => {
        const vehicle = row.vehicle ?? row.gateEvent?.vehicle;
        return vehicle ? [{ id: vehicle.id, label: vehicle.registrationNumber, occurredAt: row.raisedAt, record: { type: "EXCEPTION", id: row.id, occurredAt: row.raisedAt.toISOString(), summary: "Baseline governance exception" } }] : [];
      }));
      for (const [subjectId, currentGroup] of current) {
        const currentCount = currentGroup.entries.length;
        const baselineCount = baseline.get(subjectId)?.entries.length ?? 0;
        if (currentCount < rule.minimumOccurrenceCount || currentCount < rule.minimumSampleSize || baselineCount < rule.minimumSampleSize) continue;
        const increase = ((currentCount - baselineCount) / baselineCount) * 100;
        if (increase < threshold) continue;
        const bounds = recordBounds(currentGroup.entries);
        candidates.push({
          rule,
          subjectType: "VEHICLE",
          subjectId,
          subjectLabel: currentGroup.label,
          occurrenceCount: currentCount,
          firstDetectedAt: bounds.first,
          lastDetectedAt: bounds.last,
          title: "Exception frequency changed from the previous baseline",
          explanation: `${currentCount} exceptions occurred in the current ${rule.evaluationPeriodDays}-day period versus ${baselineCount} in the prior ${baselineDays}-day baseline, an increase of ${increase.toFixed(1)}%. The configured threshold was ${threshold}% with a minimum sample of ${rule.minimumSampleSize}.`,
          recommendedAction: "Review the underlying records and changes in operating volume or conditions before deciding whether follow-up is warranted.",
          supportingRecords: bounds.records,
          dataQuality: truncated ? "INCOMPLETE" : "COMPLETE",
        });
      }
    }
  }

  return { candidates, dataQuality: worstDataQuality([truncated ? "INCOMPLETE" : "COMPLETE", ...candidates.map((candidate) => candidate.dataQuality)]), localEvaluationDate: localDateKey(new Date(evaluationEnd.getTime() - 1), timezone) };
}

async function persistCandidate(tenantId: string, candidate: Candidate, evaluationStart: Date, evaluationEnd: Date) {
  const calculationKey = crypto.createHash("sha256").update([tenantId, candidate.rule.code, candidate.subjectType, candidate.subjectId, evaluationStart.toISOString(), evaluationEnd.toISOString()].join("|")).digest("hex");
  const existing = await prisma.analyticsIndicator.findUnique({ where: { calculationKey } });
  if (existing) {
    // A rule-version change never rewrites a historical threshold snapshot.
    if (existing.ruleVersion !== candidate.rule.version) return "suppressed" as const;
    await prisma.analyticsIndicator.update({
      where: { id: existing.id },
      data: {
        lastDetectedAt: candidate.lastDetectedAt,
        occurrenceCount: candidate.occurrenceCount,
        supportingRecords: candidate.supportingRecords as Prisma.InputJsonValue,
        dataQuality: candidate.dataQuality,
        explanation: candidate.explanation,
      },
    });
    return "updated" as const;
  }

  if (candidate.rule.cooldownDays > 0) {
    const duplicate = await prisma.analyticsIndicator.findFirst({
      where: {
        tenantId,
        ruleCode: candidate.rule.code,
        subjectType: candidate.subjectType,
        subjectId: candidate.subjectId,
        lastDetectedAt: { gte: subtractDays(evaluationEnd, candidate.rule.cooldownDays) },
      },
      select: { id: true },
    });
    if (duplicate) return "suppressed" as const;
  }

  try {
    await prisma.analyticsIndicator.create({
      data: {
        tenantId,
        ruleId: candidate.rule.id,
        ruleCode: candidate.rule.code,
        ruleVersion: candidate.rule.version,
        ruleSnapshot: snapshotAnalyticsRule(candidate.rule),
        evaluationStart,
        evaluationEnd,
        subjectType: candidate.subjectType,
        subjectId: candidate.subjectId,
        subjectLabel: candidate.subjectLabel,
        severity: candidate.rule.severity,
        title: candidate.title,
        explanation: candidate.explanation,
        recommendedAction: candidate.recommendedAction,
        supportingRecords: candidate.supportingRecords as Prisma.InputJsonValue,
        dataQuality: candidate.dataQuality,
        firstDetectedAt: candidate.firstDetectedAt,
        lastDetectedAt: candidate.lastDetectedAt,
        occurrenceCount: candidate.occurrenceCount,
        calculationKey,
      },
    });
    return "created" as const;
  } catch (error) {
    if (isP2002(error)) return "suppressed" as const;
    throw error;
  }
}

/** Idempotent for a tenant-local evaluation day; safe under concurrent retries. */
export async function calculateAnalyticsForTenant(tenantId: string, now = new Date()) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, status: true } });
  if (!tenant || tenant.status !== "ACTIVE") return null;
  const run = await prisma.analyticsCalculationRun.create({ data: { tenantId, status: "RUNNING" } });
  try {
    await ensureDefaultAnalyticsRules(tenantId);
    const rules = await prisma.analyticsRule.findMany({ where: { tenantId, supersededAt: null }, orderBy: { code: "asc" } });
    const endDate = localDateKey(now, tenant.timezone);
    const { endExclusive: evaluationEnd } = reportingRangeFromDateOnly(endDate, endDate, tenant.timezone, now);
    const built = await buildCandidates(tenantId, rules, evaluationEnd, tenant.timezone);
    let indicatorsCreated = 0;
    let indicatorsUpdated = 0;
    let indicatorsSuppressed = 0;
    for (const candidate of built.candidates) {
      const evaluationStart = subtractTenantCalendarDays(evaluationEnd, candidate.rule.evaluationPeriodDays, tenant.timezone);
      const result = await persistCandidate(tenantId, candidate, evaluationStart, evaluationEnd);
      if (result === "created") indicatorsCreated += 1;
      else if (result === "updated") indicatorsUpdated += 1;
      else indicatorsSuppressed += 1;
    }
    const summary = { tenantId, localEvaluationDate: built.localEvaluationDate, rulesEvaluated: rules.filter((rule) => rule.enabled).length, candidates: built.candidates.length, indicatorsCreated, indicatorsUpdated, indicatorsSuppressed, dataQuality: built.dataQuality };
    await prisma.analyticsCalculationRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), rulesEvaluated: summary.rulesEvaluated, indicatorsCreated, indicatorsUpdated, indicatorsSuppressed, dataQuality: built.dataQuality, resultSummary: summary } });
    return summary;
  } catch (error) {
    await prisma.analyticsCalculationRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: error instanceof Error ? error.message : "Unknown analytics calculation error" } });
    throw error;
  }
}

export async function calculateAnalyticsForAllTenants(now = new Date()) {
  const tenants = await prisma.tenant.findMany({ where: { status: "ACTIVE", slug: { not: "platform" } }, select: { id: true }, orderBy: { id: "asc" }, take: JOB_TENANT_LIMIT });
  const results: Array<{ tenantId: string; ok: boolean; result?: unknown; error?: string }> = [];
  for (const tenant of tenants) {
    try {
      results.push({ tenantId: tenant.id, ok: true, result: await calculateAnalyticsForTenant(tenant.id, now) });
    } catch (error) {
      results.push({ tenantId: tenant.id, ok: false, error: error instanceof Error ? error.message : "Unknown analytics calculation error" });
    }
  }
  return { tenantCount: tenants.length, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, results };
}

export { QUERY_ROW_LIMIT };
