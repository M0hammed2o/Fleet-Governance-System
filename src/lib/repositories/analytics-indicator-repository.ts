import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { hasPermission, requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import { createInvestigationCaseInternal, InvestigationCaseNotFoundError } from "@/lib/repositories/investigation-case-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { AnalyticsIndicatorStatus, AnalyticsSubjectType, ExceptionSeverity, Prisma } from "@/generated/prisma/client";

export class AnalyticsIndicatorNotFoundError extends Error {
  constructor() {
    super("Analytics indicator not found.");
    this.name = "AnalyticsIndicatorNotFoundError";
  }
}

export class AnalyticsIndicatorTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsIndicatorTransitionError";
  }
}

export interface IndicatorListFilters {
  status?: AnalyticsIndicatorStatus;
  severity?: ExceptionSeverity;
  ruleCode?: string;
  subjectType?: AnalyticsSubjectType;
  subjectId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listAnalyticsIndicators(session: AuthenticatedSession, filters: IndicatorListFilters = {}) {
  await requirePermission(session, "analyticsIndicator", "VIEW");
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const where: Prisma.AnalyticsIndicatorWhereInput = {
    tenantId: session.tenantId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.ruleCode ? { ruleCode: filters.ruleCode } : {}),
    ...(filters.subjectType ? { subjectType: filters.subjectType } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.from || filters.to ? { lastDetectedAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.analyticsIndicator.findMany({
      where,
      select: { id: true, ruleCode: true, ruleVersion: true, subjectType: true, subjectId: true, subjectLabel: true, severity: true, title: true, explanation: true, dataQuality: true, occurrenceCount: true, status: true, firstDetectedAt: true, lastDetectedAt: true, reviewedAt: true, linkedInvestigationCaseId: true },
      orderBy: [{ status: "asc" }, { severity: "desc" }, { lastDetectedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.analyticsIndicator.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

type StoredReference = { type?: unknown; id?: unknown; occurredAt?: unknown; summary?: unknown };

async function permittedSupportingTypes(session: AuthenticatedSession) {
  const [exceptionView, gateView, movementView, reconciliationView, telematicsView, investigationView, confidentialInvestigationView] = await Promise.all([
    hasPermission(session, "exception", "VIEW"),
    hasPermission(session, "gateEvent", "VIEW"),
    hasPermission(session, "movement", "VIEW"),
    hasPermission(session, "reconciliation", "VIEW"),
    hasPermission(session, "telematics", "VIEW"),
    hasPermission(session, "investigationCase", "VIEW"),
    hasPermission(session, "investigationConfidentialAccess", "VIEW"),
  ]);
  return new Set([
    ...(exceptionView ? ["EXCEPTION"] : []),
    ...(gateView ? ["GATE_EVENT", "INSPECTION_ITEM"] : []),
    ...(movementView ? ["MOVEMENT"] : []),
    ...(reconciliationView ? ["RECONCILIATION", "RECONCILIATION_DISCREPANCY"] : []),
    ...(telematicsView ? ["TELEMATICS_EVENT"] : []),
    ...(investigationView && confidentialInvestigationView ? ["INVESTIGATION_CASE"] : []),
  ]);
}

function normalizeReferences(value: Prisma.JsonValue): StoredReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => item as StoredReference);
}

async function existingTenantSupportingKeys(tenantId: string, references: StoredReference[]) {
  const idsFor = (type: string) => references.flatMap((reference) => reference.type === type && typeof reference.id === "string" ? [reference.id] : []);
  const specifications: Array<[string, (ids: string[]) => Promise<Array<{ id: string }>>]> = [
    ["EXCEPTION", (ids) => prisma.exception.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
    ["GATE_EVENT", (ids) => prisma.gateEvent.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
    ["INSPECTION_ITEM", (ids) => prisma.gateEventInspectionItem.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
    ["MOVEMENT", (ids) => prisma.movementAuthorisation.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
    ["RECONCILIATION", (ids) => prisma.reconciliation.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
    ["RECONCILIATION_DISCREPANCY", (ids) => prisma.reconciliationDiscrepancy.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
    ["TELEMATICS_EVENT", (ids) => prisma.telematicsEvent.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
    ["INVESTIGATION_CASE", (ids) => prisma.investigationCase.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })],
  ];
  const rows = await Promise.all(specifications.flatMap(([type, query]) => {
    const ids = idsFor(type);
    return ids.length ? [query(ids).then((items) => items.map((item) => `${type}:${item.id}`))] : [];
  }));
  return new Set(rows.flat());
}

export async function getAnalyticsIndicator(session: AuthenticatedSession, indicatorId: string) {
  await requirePermission(session, "analyticsIndicator", "VIEW");
  const indicator = await prisma.analyticsIndicator.findFirst({
    where: tenantWhere(session.tenantId, { id: indicatorId }),
    include: {
      rule: { select: { id: true, code: true, label: true, description: true, version: true } },
      reviewedBy: { select: { id: true, name: true } },
      linkedInvestigationCase: { select: { id: true, caseNumber: true, confidentiality: true } },
      events: { include: { actor: { select: { id: true, name: true } } }, orderBy: { occurredAt: "asc" } },
    },
  });
  if (!indicator) throw new AnalyticsIndicatorNotFoundError();
  const allowedTypes = await permittedSupportingTypes(session);
  const allReferences = normalizeReferences(indicator.supportingRecords);
  const permittedReferences = allReferences.filter((reference) => typeof reference.type === "string" && allowedTypes.has(reference.type) && typeof reference.id === "string");
  const existingKeys = await existingTenantSupportingKeys(session.tenantId, permittedReferences);
  const supportingRecords = permittedReferences.filter((reference) => existingKeys.has(`${reference.type}:${reference.id}`));
  return { ...indicator, supportingRecords, withheldSupportingRecordCount: allReferences.length - supportingRecords.length };
}

async function transitionIndicator(
  session: AuthenticatedSession,
  indicatorId: string,
  toStatus: AnalyticsIndicatorStatus,
  note: string,
  allowedFrom: AnalyticsIndicatorStatus[],
  action: string,
) {
  await requirePermission(session, "analyticsIndicator", "EDIT");
  const current = await prisma.analyticsIndicator.findFirst({ where: tenantWhere(session.tenantId, { id: indicatorId }) });
  if (!current) throw new AnalyticsIndicatorNotFoundError();
  if (!allowedFrom.includes(current.status)) throw new AnalyticsIndicatorTransitionError(`This indicator cannot move from ${current.status} to ${toStatus}.`);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.analyticsIndicator.update({
      where: { id: current.id },
      data: {
        status: toStatus,
        reviewedByUserId: session.userId,
        reviewedAt: now,
        reviewNotes: note,
      },
    });
    await tx.analyticsIndicatorEvent.create({ data: { tenantId: session.tenantId, indicatorId: current.id, action, fromStatus: current.status, toStatus, note, actorUserId: session.userId } });
    return changed;
  });
  await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: `analytics.indicator.${action}`, entityType: "AnalyticsIndicator", entityId: current.id, beforeValue: { status: current.status }, afterValue: { status: toStatus }, reason: note });
  return updated;
}

export function markAnalyticsIndicatorReviewed(session: AuthenticatedSession, indicatorId: string, note: string) {
  return transitionIndicator(session, indicatorId, "REVIEWED", note, ["OPEN"], "reviewed");
}

export function dismissAnalyticsIndicator(session: AuthenticatedSession, indicatorId: string, note: string) {
  return transitionIndicator(session, indicatorId, "DISMISSED", note, ["OPEN", "REVIEWED"], "dismissed");
}

export function reopenAnalyticsIndicator(session: AuthenticatedSession, indicatorId: string, note: string) {
  return transitionIndicator(session, indicatorId, "OPEN", note, ["DISMISSED", "REVIEWED", "ESCALATED"], "reopened");
}

export async function escalateAnalyticsIndicatorToInvestigation(
  session: AuthenticatedSession,
  indicatorId: string,
  note: string,
  existingInvestigationCaseId?: string,
) {
  await requirePermission(session, "analyticsIndicator", "EDIT");
  await requirePermission(session, "analyticsIndicator", "CREATE");
  const indicator = await prisma.analyticsIndicator.findFirst({ where: tenantWhere(session.tenantId, { id: indicatorId }) });
  if (!indicator) throw new AnalyticsIndicatorNotFoundError();
  if (indicator.status === "DISMISSED") throw new AnalyticsIndicatorTransitionError("Reopen a dismissed indicator before escalation.");
  if (indicator.linkedInvestigationCaseId) throw new AnalyticsIndicatorTransitionError("This indicator is already linked to an investigation.");

  let investigationCase;
  if (existingInvestigationCaseId) {
    await requirePermission(session, "investigationCase", "EDIT");
    investigationCase = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: existingInvestigationCaseId }) });
    if (!investigationCase) throw new InvestigationCaseNotFoundError();
  } else {
    await requirePermission(session, "investigationCase", "CREATE");
    investigationCase = await createInvestigationCaseInternal(session, {
      title: `Governance review: ${indicator.title}`,
      description: `A deterministic analytics indicator was escalated for authorised human review. ${indicator.explanation}\n\nReviewer note: ${note}`,
      source: "OTHER",
      category: "DATA_INTEGRITY",
      priority: indicator.severity,
      confidentiality: "STANDARD",
      caseOwnerUserId: session.userId,
    });
  }

  const fromStatus = indicator.status;
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.analyticsIndicator.update({
      where: { id: indicator.id },
      data: { status: "ESCALATED", reviewedByUserId: session.userId, reviewedAt: new Date(), reviewNotes: note, linkedInvestigationCaseId: investigationCase.id },
    });
    await tx.analyticsIndicatorEvent.create({
      data: { tenantId: session.tenantId, indicatorId: indicator.id, action: existingInvestigationCaseId ? "linkedToInvestigation" : "escalatedToInvestigation", fromStatus, toStatus: "ESCALATED", note, actorUserId: session.userId },
    });
    return changed;
  });
  await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: "analytics.indicator.escalated", entityType: "AnalyticsIndicator", entityId: indicator.id, beforeValue: { status: fromStatus }, afterValue: { status: "ESCALATED", investigationCaseId: investigationCase.id }, reason: note });
  return { indicator: updated, investigationCase: { id: investigationCase.id, caseNumber: investigationCase.caseNumber } };
}
