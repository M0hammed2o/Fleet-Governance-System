import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { createInvestigationCaseInternal, linkRelatedRecordInternal, type CreateInvestigationCaseInput } from "@/lib/repositories/investigation-case-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { InvestigationCase, InvestigationRelatedRecordType, InvestigationSource } from "@/generated/prisma/client";

export class SourceRecordNotFoundError extends Error {
  constructor() {
    super("The operational record being referred to an investigation was not found in this tenant.");
    this.name = "SourceRecordNotFoundError";
  }
}

export interface ReferralResult {
  investigationCase: InvestigationCase;
  /** True if an existing open referral for this exact record was found and reused instead of creating a duplicate (P11B hard requirement). */
  wasExistingCase: boolean;
}

export interface CreateCaseFromReferralInput extends Omit<CreateInvestigationCaseInput, "source"> {
  source: InvestigationSource;
  relatedRecordType: InvestigationRelatedRecordType;
  relatedRecordId: string;
  snapshotSummary: Record<string, unknown>;
}

/**
 * Creates a case from an operational referral, or returns the existing case
 * unchanged if that exact source record already has an open referral
 * (P11B: "prevent accidental duplicates" — a source record's referral is
 * looked up by (tenantId, recordType, recordId, isReferralSource: true)
 * joined to a still-open case; CLOSED cases don't block a fresh referral,
 * since new information can legitimately warrant reopening the topic as a
 * new case). Linking never modifies the source record itself (P11B hard
 * requirement) — see linkRelatedRecord()'s own comment.
 */
export async function createCaseFromReferral(session: AuthenticatedSession, input: CreateCaseFromReferralInput): Promise<ReferralResult> {
  // Deliberately investigationReferral:CREATE, not investigationCase:CREATE
  // — a wide, low-privilege role (Gate Security Officer/Dispatch) can raise
  // a referral without gaining ordinary case-management visibility/edit
  // rights (P11K/P11M).
  await requirePermission(session, "investigationReferral", "CREATE");

  const existingReferral = await prisma.investigationRelatedRecord.findFirst({
    where: {
      tenantId: session.tenantId,
      recordType: input.relatedRecordType,
      recordId: input.relatedRecordId,
      isReferralSource: true,
      case: { status: { not: "CLOSED" } },
    },
    include: { case: true },
  });
  if (existingReferral) {
    return { investigationCase: existingReferral.case, wasExistingCase: true };
  }

  const investigationCase = await createInvestigationCaseInternal(session, {
    title: input.title,
    description: input.description,
    source: input.source,
    category: input.category,
    priority: input.priority,
    confidentiality: input.confidentiality,
    // The referring user is the reporting person unless a different one was
    // explicitly supplied (e.g. a manual concern raised on someone else's
    // behalf).
    reportingPersonUserId: input.reportingPersonUserId ?? session.userId,
    reportingPersonName: input.reportingPersonName,
    caseOwnerUserId: input.caseOwnerUserId,
  });

  await linkRelatedRecordInternal(session, investigationCase.id, {
    recordType: input.relatedRecordType,
    recordId: input.relatedRecordId,
    snapshotSummary: input.snapshotSummary,
    isReferralSource: true,
  });

  return { investigationCase, wasExistingCase: false };
}

export interface ReferralCaseFields {
  title: string;
  category?: CreateCaseFromReferralInput["category"];
  priority?: CreateCaseFromReferralInput["priority"];
  confidentiality?: CreateCaseFromReferralInput["confidentiality"];
  // Deliberately required, not defaulted to the referring user — a referral
  // is typically raised by a low-privilege role (Gate Security Officer/
  // Dispatch, investigationReferral:CREATE only) that must never end up
  // owning a case it cannot itself view or manage. Callers (API routes)
  // resolve this to an authorised case-management user, e.g. the tenant's
  // configured default Investigation Manager.
  caseOwnerUserId: string;
}

/** Covers both a generic gate exception and a GPS/geofence policy violation — the same underlying Exception model (P11B). */
export async function referExceptionToInvestigation(session: AuthenticatedSession, exceptionId: string, fields: ReferralCaseFields): Promise<ReferralResult> {
  const exception = await prisma.exception.findFirst({ where: tenantWhere(session.tenantId, { id: exceptionId }) });
  if (!exception) throw new SourceRecordNotFoundError();

  const source: InvestigationSource = exception.violationType ? "GPS_GEOFENCE_EXCEPTION" : "GATE_EXCEPTION";
  return createCaseFromReferral(session, {
    ...fields,
    source,
    description: exception.description,
    relatedRecordType: "EXCEPTION",
    relatedRecordId: exceptionId,
    snapshotSummary: {
      description: exception.description,
      severity: exception.severity,
      outcomeAction: exception.outcomeAction,
      raisedAt: exception.raisedAt,
      violationType: exception.violationType,
      gateEventId: exception.gateEventId,
      vehicleId: exception.vehicleId,
    },
  });
}

export async function referFacialVerificationFailureToInvestigation(session: AuthenticatedSession, attemptId: string, fields: ReferralCaseFields): Promise<ReferralResult> {
  const attempt = await prisma.facialVerificationAttempt.findFirst({ where: tenantWhere(session.tenantId, { id: attemptId }) });
  if (!attempt) throw new SourceRecordNotFoundError();

  return createCaseFromReferral(session, {
    ...fields,
    source: "FACIAL_VERIFICATION_FAILURE",
    description: `Facial verification result: ${attempt.result} at gate event.`,
    relatedRecordType: "FACIAL_VERIFICATION_ATTEMPT",
    relatedRecordId: attemptId,
    snapshotSummary: {
      // Deliberately no biometric template/descriptor data — result/scoring
      // metadata only (P11F hard requirement: never expose biometric
      // templates in an investigation record).
      result: attempt.result,
      confidenceScore: attempt.confidenceScore,
      livenessResult: attempt.livenessResult,
      source: attempt.source,
      attemptedAt: attempt.attemptedAt,
      gateEventId: attempt.gateEventId,
      driverId: attempt.driverId,
    },
  });
}

export async function referInspectionFailureToInvestigation(session: AuthenticatedSession, inspectionItemId: string, fields: ReferralCaseFields): Promise<ReferralResult> {
  const item = await prisma.gateEventInspectionItem.findFirst({
    where: tenantWhere(session.tenantId, { id: inspectionItemId }),
    include: { inspectionItem: true },
  });
  if (!item) throw new SourceRecordNotFoundError();

  const source: InvestigationSource = item.inspectionItem?.section === "LOAD_VERIFICATION" ? "CARGO_LOAD_DISCREPANCY" : "VEHICLE_INSPECTION_FAILURE";
  return createCaseFromReferral(session, {
    ...fields,
    source,
    description: item.comment ?? `Inspection item failed: ${item.inspectionItem?.label ?? item.inspectionItemId}.`,
    relatedRecordType: "GATE_EVENT_INSPECTION_ITEM",
    relatedRecordId: inspectionItemId,
    snapshotSummary: {
      outcome: item.outcome,
      comment: item.comment,
      readingValue: item.readingValue,
      readingUnit: item.readingUnit,
      itemLabel: item.inspectionItem?.label,
      gateEventId: item.gateEventId,
      recordedAt: item.recordedAt,
    },
  });
}

export async function referReconciliationDiscrepancyToInvestigation(session: AuthenticatedSession, discrepancyId: string, fields: ReferralCaseFields): Promise<ReferralResult> {
  const discrepancy = await prisma.reconciliationDiscrepancy.findFirst({ where: tenantWhere(session.tenantId, { id: discrepancyId }) });
  if (!discrepancy) throw new SourceRecordNotFoundError();

  const source: InvestigationSource =
    discrepancy.category === "CARGO_AND_LOAD"
      ? "CARGO_LOAD_DISCREPANCY"
      : discrepancy.category === "ODOMETER" || discrepancy.category === "FUEL" || discrepancy.category === "VEHICLE_CONDITION" || discrepancy.category === "TYRE_CONDITION"
        ? "ODOMETER_FUEL_CONDITION_DISCREPANCY"
        : "RECONCILIATION_DISCREPANCY";

  return createCaseFromReferral(session, {
    ...fields,
    source,
    description: discrepancy.description,
    relatedRecordType: "RECONCILIATION_DISCREPANCY",
    relatedRecordId: discrepancyId,
    snapshotSummary: {
      category: discrepancy.category,
      severity: discrepancy.severity,
      description: discrepancy.description,
      departureValue: discrepancy.departureValue,
      returnValue: discrepancy.returnValue,
      deltaValue: discrepancy.deltaValue,
      reconciliationId: discrepancy.reconciliationId,
    },
  });
}
