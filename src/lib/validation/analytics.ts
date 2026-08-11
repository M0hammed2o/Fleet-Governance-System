import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const optionalId = z.string().trim().min(1).max(100).optional();

export const analyticsFilterSchema = z.object({
  startDate: dateOnly,
  endDate: dateOnly,
  siteId: optionalId,
  gateId: optionalId,
  vehicleId: optionalId,
  driverId: optionalId,
  movementType: z.enum(["ENTRY", "EXIT", "DELIVERY", "COLLECTION", "RETURN", "SITE_TRANSFER", "MAINTENANCE", "OTHER", "SALES_VISIT", "SERVICE", "AUTHORISED_PRIVATE_USE"]).optional(),
  department: z.string().trim().max(200).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  exceptionStatus: z.enum(["OPEN", "RESOLVED"]).optional(),
  investigationStatus: z.enum(["DRAFT", "OPEN", "TRIAGE", "UNDER_INVESTIGATION", "AWAITING_INFORMATION", "AWAITING_APPROVAL", "CLOSED", "REOPENED"]).optional(),
});

export type AnalyticsFilterInput = z.infer<typeof analyticsFilterSchema>;

export function analyticsFiltersFromUrl(url: string): AnalyticsFilterInput {
  const params = new URL(url).searchParams;
  const values = Object.fromEntries(
    ["startDate", "endDate", "siteId", "gateId", "vehicleId", "driverId", "movementType", "department", "severity", "exceptionStatus", "investigationStatus"]
      .map((key) => [key, params.get(key) ?? undefined]),
  );
  return analyticsFilterSchema.parse(values);
}

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm in 24-hour time").nullable().optional();

export const updateAnalyticsRuleSchema = z.object({
  enabled: z.boolean().optional(),
  evaluationPeriodDays: z.number().int().min(1).max(366).optional(),
  minimumOccurrenceCount: z.number().int().min(1).max(1000).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  percentageThreshold: z.number().min(1).max(1000).nullable().optional(),
  numericThreshold: z.number().min(0).max(1_000_000).nullable().optional(),
  operatingHourStart: timeOfDay,
  operatingHourEnd: timeOfDay,
  staleDataHours: z.number().int().min(1).max(720).nullable().optional(),
  baselinePeriodDays: z.number().int().min(1).max(730).nullable().optional(),
  minimumSampleSize: z.number().int().min(1).max(1000).optional(),
  cooldownDays: z.number().int().min(0).max(365).optional(),
});

export const indicatorReviewSchema = z.object({ note: z.string().trim().min(1).max(5000) });
export const indicatorEscalationSchema = z.object({
  note: z.string().trim().min(1).max(5000),
  existingInvestigationCaseId: z.string().trim().min(1).optional(),
});

export const indicatorListFilterSchema = z.object({
  status: z.enum(["OPEN", "REVIEWED", "DISMISSED", "ESCALATED"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  subjectType: z.enum(["TENANT", "SITE", "GATE", "VEHICLE", "DRIVER", "MOVEMENT"]).optional(),
  subjectId: optionalId,
  ruleCode: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
