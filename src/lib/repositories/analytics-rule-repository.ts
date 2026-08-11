import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { ExceptionSeverity, Prisma } from "@/generated/prisma/client";

export interface DefaultAnalyticsRule {
  code: string;
  label: string;
  description: string;
  evaluationPeriodDays: number;
  minimumOccurrenceCount: number;
  severity: ExceptionSeverity;
  percentageThreshold?: number;
  numericThreshold?: number;
  operatingHourStart?: string;
  operatingHourEnd?: string;
  staleDataHours?: number;
  baselinePeriodDays?: number;
  minimumSampleSize?: number;
  cooldownDays?: number;
}

/**
 * Conservative deterministic defaults. Every explanation emitted by the
 * calculator names the applicable values from the persisted version, never
 * from this in-memory catalogue.
 */
export const DEFAULT_ANALYTICS_RULES: readonly DefaultAnalyticsRule[] = [
  {
    code: "REPEATED_VEHICLE_EXCEPTIONS",
    label: "Repeated vehicle exceptions",
    description: "Flags a vehicle only after several governance exceptions occur in the configured period.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 3,
    severity: "MEDIUM",
    cooldownDays: 7,
  },
  {
    code: "REPEATED_DRIVER_EXCEPTIONS",
    label: "Repeated driver exceptions",
    description: "Flags a driver only after several linked gate exceptions occur in the configured period.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 3,
    severity: "MEDIUM",
    cooldownDays: 7,
  },
  {
    code: "REPEATED_INSPECTION_FAILURES",
    label: "Repeated inspection failures",
    description: "Finds repeated failed inspection answers for one vehicle.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 3,
    severity: "MEDIUM",
    cooldownDays: 7,
  },
  {
    code: "REPEATED_GATE_OVERRIDES",
    label: "Repeated gate clearances with exceptions",
    description: "Finds repeated cleared gate events that also recorded governance exceptions.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 3,
    severity: "HIGH",
    cooldownDays: 7,
  },
  {
    code: "REPEATED_LATE_RETURNS",
    label: "Repeated late returns",
    description: "Finds movements whose completed return occurred after the authorised expected return time.",
    evaluationPeriodDays: 60,
    minimumOccurrenceCount: 3,
    severity: "MEDIUM",
    cooldownDays: 14,
  },
  {
    code: "UNUSUALLY_LONG_MOVEMENTS",
    label: "Unusually long movement duration",
    description: "Finds completed movements exceeding a configured elapsed-hours threshold.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 2,
    numericThreshold: 24,
    severity: "MEDIUM",
    cooldownDays: 7,
  },
  {
    code: "MISSING_RETURN_RECONCILIATIONS",
    label: "Missing return reconciliations",
    description: "Finds completed movements that do not have a completed return reconciliation.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 2,
    severity: "HIGH",
    cooldownDays: 7,
  },
  {
    code: "REPEATED_DATA_INCONSISTENCIES",
    label: "Repeated reconciliation inconsistencies",
    description: "Finds repeated odometer, fuel, cargo/load, tyre or vehicle-condition discrepancies supported by the reconciliation schema.",
    evaluationPeriodDays: 60,
    minimumOccurrenceCount: 3,
    severity: "HIGH",
    cooldownDays: 14,
  },
  {
    code: "TRACKER_STALE_OR_UNAVAILABLE",
    label: "Tracking information stale or unavailable",
    description: "Finds tracked vehicles whose latest communication is missing or older than the configured threshold.",
    evaluationPeriodDays: 7,
    minimumOccurrenceCount: 1,
    staleDataHours: 24,
    severity: "LOW",
    cooldownDays: 3,
  },
  {
    code: "SITE_EXCEPTION_CONCENTRATION",
    label: "Site exception concentration",
    description: "Finds sites with a high count of exceptions in the configured period.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 10,
    minimumSampleSize: 10,
    severity: "MEDIUM",
    cooldownDays: 7,
  },
  {
    code: "OUTSIDE_EXPECTED_OPERATING_HOURS",
    label: "Activity outside expected operating hours",
    description: "Finds repeated gate activity outside the tenant-configured review window.",
    evaluationPeriodDays: 30,
    minimumOccurrenceCount: 3,
    operatingHourStart: "06:00",
    operatingHourEnd: "20:00",
    severity: "LOW",
    cooldownDays: 7,
  },
  {
    code: "SUDDEN_EXCEPTION_INCREASE",
    label: "Sudden change from previous baseline",
    description: "Compares a vehicle's current exception count with its prior baseline period using a minimum sample size.",
    evaluationPeriodDays: 30,
    baselinePeriodDays: 30,
    minimumOccurrenceCount: 3,
    minimumSampleSize: 3,
    percentageThreshold: 100,
    severity: "MEDIUM",
    cooldownDays: 14,
  },
] as const;

export class AnalyticsRuleNotFoundError extends Error {
  constructor() {
    super("Analytics rule not found.");
    this.name = "AnalyticsRuleNotFoundError";
  }
}

export class AnalyticsRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsRuleValidationError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function ensureDefaultAnalyticsRules(tenantId: string): Promise<void> {
  await prisma.analyticsRule.createMany({
    data: DEFAULT_ANALYTICS_RULES.map((rule) => ({
      tenantId,
      code: rule.code,
      label: rule.label,
      description: rule.description,
      evaluationPeriodDays: rule.evaluationPeriodDays,
      minimumOccurrenceCount: rule.minimumOccurrenceCount,
      severity: rule.severity,
      percentageThreshold: rule.percentageThreshold ?? null,
      numericThreshold: rule.numericThreshold ?? null,
      operatingHourStart: rule.operatingHourStart ?? null,
      operatingHourEnd: rule.operatingHourEnd ?? null,
      staleDataHours: rule.staleDataHours ?? null,
      baselinePeriodDays: rule.baselinePeriodDays ?? null,
      minimumSampleSize: rule.minimumSampleSize ?? 3,
      cooldownDays: rule.cooldownDays ?? 7,
      configuredByUserId: null,
    })),
    skipDuplicates: true,
  });
}

export async function listCurrentAnalyticsRules(session: AuthenticatedSession) {
  await requirePermission(session, "analyticsRule", "VIEW");
  await ensureDefaultAnalyticsRules(session.tenantId);
  return prisma.analyticsRule.findMany({
    where: { tenantId: session.tenantId, supersededAt: null },
    include: { configuredBy: { select: { id: true, name: true } } },
    orderBy: { label: "asc" },
  });
}

export type AnalyticsRuleUpdate = Partial<{
  enabled: boolean;
  evaluationPeriodDays: number;
  minimumOccurrenceCount: number;
  severity: ExceptionSeverity;
  percentageThreshold: number | null;
  numericThreshold: number | null;
  operatingHourStart: string | null;
  operatingHourEnd: string | null;
  staleDataHours: number | null;
  baselinePeriodDays: number | null;
  minimumSampleSize: number;
  cooldownDays: number;
}>;

export async function createAnalyticsRuleVersion(session: AuthenticatedSession, ruleId: string, changes: AnalyticsRuleUpdate) {
  await requirePermission(session, "analyticsRule", "CONFIGURE");
  const current = await prisma.analyticsRule.findFirst({ where: { id: ruleId, tenantId: session.tenantId, supersededAt: null } });
  if (!current) throw new AnalyticsRuleNotFoundError();
  if (Object.keys(changes).length === 0) throw new AnalyticsRuleValidationError("At least one rule setting must change.");

  const now = new Date();
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const superseded = await tx.analyticsRule.updateMany({
        where: { id: current.id, tenantId: session.tenantId, supersededAt: null },
        data: { supersededAt: now },
      });
      if (superseded.count !== 1) throw new AnalyticsRuleValidationError("The rule changed while you were editing it. Reload and try again.");
      return tx.analyticsRule.create({
        data: {
          tenantId: current.tenantId,
          code: current.code,
          label: current.label,
          description: current.description,
          version: current.version + 1,
          enabled: changes.enabled ?? current.enabled,
          evaluationPeriodDays: changes.evaluationPeriodDays ?? current.evaluationPeriodDays,
          minimumOccurrenceCount: changes.minimumOccurrenceCount ?? current.minimumOccurrenceCount,
          severity: changes.severity ?? current.severity,
          percentageThreshold: changes.percentageThreshold === undefined ? current.percentageThreshold : changes.percentageThreshold,
          numericThreshold: changes.numericThreshold === undefined ? current.numericThreshold : changes.numericThreshold,
          operatingHourStart: changes.operatingHourStart === undefined ? current.operatingHourStart : changes.operatingHourStart,
          operatingHourEnd: changes.operatingHourEnd === undefined ? current.operatingHourEnd : changes.operatingHourEnd,
          staleDataHours: changes.staleDataHours === undefined ? current.staleDataHours : changes.staleDataHours,
          baselinePeriodDays: changes.baselinePeriodDays === undefined ? current.baselinePeriodDays : changes.baselinePeriodDays,
          minimumSampleSize: changes.minimumSampleSize ?? current.minimumSampleSize,
          cooldownDays: changes.cooldownDays ?? current.cooldownDays,
          configuredByUserId: session.userId,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AnalyticsRuleValidationError("The rule changed while you were editing it. Reload and try again.");
    throw error;
  }

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "analytics.ruleVersionCreated",
    entityType: "AnalyticsRule",
    entityId: created.id,
    beforeValue: current,
    afterValue: created,
    reason: `Rule ${current.code} version ${created.version}`,
  });
  return created;
}

export function snapshotAnalyticsRule(rule: {
  code: string;
  version: number;
  enabled: boolean;
  evaluationPeriodDays: number;
  minimumOccurrenceCount: number;
  severity: ExceptionSeverity;
  percentageThreshold: number | null;
  numericThreshold: number | null;
  operatingHourStart: string | null;
  operatingHourEnd: string | null;
  staleDataHours: number | null;
  baselinePeriodDays: number | null;
  minimumSampleSize: number;
  cooldownDays: number;
}): Prisma.InputJsonObject {
  return {
    code: rule.code,
    version: rule.version,
    enabled: rule.enabled,
    evaluationPeriodDays: rule.evaluationPeriodDays,
    minimumOccurrenceCount: rule.minimumOccurrenceCount,
    severity: rule.severity,
    percentageThreshold: rule.percentageThreshold,
    numericThreshold: rule.numericThreshold,
    operatingHourStart: rule.operatingHourStart,
    operatingHourEnd: rule.operatingHourEnd,
    staleDataHours: rule.staleDataHours,
    baselinePeriodDays: rule.baselinePeriodDays,
    minimumSampleSize: rule.minimumSampleSize,
    cooldownDays: rule.cooldownDays,
  };
}
