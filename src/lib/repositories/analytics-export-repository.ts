import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hasPermission, requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import { getGovernanceAnalyticsDashboard } from "@/lib/repositories/analytics-dashboard-repository";
import { renderGovernanceAnalyticsPdf } from "@/lib/analytics/governance-analytics-pdf";
import { uploadMediaAsset, mintSignedUrlForMediaAsset } from "@/lib/repositories/media-asset-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { AnalyticsFilterInput } from "@/lib/validation/analytics";

const EXPORT_INDICATOR_LIMIT = 5_000;

export class AnalyticsExportLimitError extends Error {
  constructor() {
    super(`Analytics exports are limited to ${EXPORT_INDICATOR_LIMIT} indicators. Narrow the reporting period or filters.`);
    this.name = "AnalyticsExportLimitError";
  }
}

export class AnalyticsReportNotFoundError extends Error {
  constructor() {
    super("Governance analytics report not found.");
    this.name = "AnalyticsReportNotFoundError";
  }
}

/** Prefix spreadsheet control characters before ordinary RFC-4180 quoting. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values: unknown[]) {
  return `${values.map(csvCell).join(",")}\r\n`;
}

export async function generateGovernanceAnalyticsCsv(session: AuthenticatedSession, filters: AnalyticsFilterInput = {}, now = new Date()) {
  await requirePermission(session, "analyticsExport", "EXPORT");
  const dashboard = await getGovernanceAnalyticsDashboard(session, filters, now);
  const canViewInvestigations = await hasPermission(session, "investigationCase", "VIEW");
  const indicatorWhere = {
    tenantId: session.tenantId,
    lastDetectedAt: { gte: dashboard.period.startUtc, lt: dashboard.period.endExclusiveUtc },
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.vehicleId ? { subjectType: "VEHICLE" as const, subjectId: filters.vehicleId } : filters.driverId ? { subjectType: "DRIVER" as const, subjectId: filters.driverId } : filters.gateId ? { subjectType: "GATE" as const, subjectId: filters.gateId } : filters.siteId ? { subjectType: "SITE" as const, subjectId: filters.siteId } : {}),
  };
  const indicators = await prisma.analyticsIndicator.findMany({
    where: indicatorWhere,
    select: { id: true, ruleCode: true, ruleVersion: true, subjectType: true, subjectLabel: true, severity: true, status: true, occurrenceCount: true, evaluationStart: true, evaluationEnd: true, dataQuality: true, title: true, explanation: true, recommendedAction: true, linkedInvestigationCaseId: true },
    orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
    take: EXPORT_INDICATOR_LIMIT + 1,
  });
  if (indicators.length > EXPORT_INDICATOR_LIMIT) throw new AnalyticsExportLimitError();

  let csv = "\uFEFF";
  csv += csvRow(["Record type", "Code or metric", "Subject type", "Subject", "Severity", "Status", "Occurrence count", "Period start", "Period end", "Data quality", "Explanation", "Recommended action", "Linked investigation"]);
  csv += csvRow(["FILTER_SUMMARY", "Applied filters", "", "", "", "", "", dashboard.period.startDate, dashboard.period.endDate, dashboard.dataQuality.status, Object.keys(filters).length ? JSON.stringify(filters) : "No optional filters applied", "", ""]);
  for (const [metric, value] of Object.entries(dashboard.executive)) {
    csv += csvRow(["METRIC", metric, "TENANT", dashboard.tenant.name, "", "", value, dashboard.period.startDate, dashboard.period.endDate, dashboard.dataQuality.status, dashboard.dataQuality.statement, "Authorised human review where a metric requires follow-up", ""]);
  }
  for (const indicator of indicators) {
    csv += csvRow(["RISK_INDICATOR", `${indicator.ruleCode} v${indicator.ruleVersion}`, indicator.subjectType, indicator.subjectLabel, indicator.severity, indicator.status, indicator.occurrenceCount, indicator.evaluationStart, indicator.evaluationEnd, indicator.dataQuality, indicator.explanation, indicator.recommendedAction, canViewInvestigations ? indicator.linkedInvestigationCaseId ?? "" : ""]);
  }
  csv += csvRow(["DISCLAIMER", "Human review required", "", "", "", "", "", dashboard.period.startDate, dashboard.period.endDate, dashboard.dataQuality.status, "Indicators are deterministic prompts for authorised human review and are not findings or accusations.", "Review supporting records and document the outcome.", ""]);

  await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: "analytics.csvExported", entityType: "Tenant", entityId: session.tenantId, afterValue: { filters, indicatorCount: indicators.length, reportingPeriod: dashboard.period } });
  return { fileName: `governance-analytics-${dashboard.period.startDate}-to-${dashboard.period.endDate}.csv`, csv, rowCount: indicators.length + Object.keys(dashboard.executive).length + 2 };
}

export async function generateGovernanceAnalyticsReport(session: AuthenticatedSession, filters: AnalyticsFilterInput = {}, now = new Date()) {
  await requirePermission(session, "analyticsExport", "EXPORT");
  const dashboard = await getGovernanceAnalyticsDashboard(session, filters, now);
  const user = await prisma.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId }, select: { name: true } });
  const pdf = await renderGovernanceAnalyticsPdf(dashboard, user?.name ?? "Authorised user", now);
  const media = await uploadMediaAsset({
    tenantId: session.tenantId,
    actorUserId: session.userId,
    ownerType: "GOVERNANCE_ANALYTICS_REPORT",
    ownerId: session.tenantId,
    fileName: `governance-analytics-${dashboard.period.startDate}-to-${dashboard.period.endDate}.pdf`,
    contentType: "application/pdf",
    data: pdf,
    idempotencyKey: `governance-analytics-report:${crypto.randomUUID()}`,
    category: "GENERATED_REPORT",
  });
  await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: "analytics.reportGenerated", entityType: "MediaAsset", entityId: media.id, afterValue: { filters, reportingPeriod: dashboard.period, dataQuality: dashboard.dataQuality.status } });
  return { id: media.id, fileName: media.fileName, fileSizeBytes: media.fileSizeBytes, createdAt: media.createdAt };
}

export async function getGovernanceAnalyticsReportDownload(session: AuthenticatedSession, mediaAssetId: string) {
  await requirePermission(session, "analyticsExport", "EXPORT");
  const media = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, tenantId: session.tenantId, ownerType: "GOVERNANCE_ANALYTICS_REPORT", ownerId: session.tenantId } });
  if (!media) throw new AnalyticsReportNotFoundError();
  await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: "analytics.reportDownloaded", entityType: "MediaAsset", entityId: media.id });
  return mintSignedUrlForMediaAsset(session.tenantId, session.userId, media.id);
}

export { EXPORT_INDICATOR_LIMIT };
