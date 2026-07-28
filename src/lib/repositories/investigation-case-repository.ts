import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission, hasPermission } from "@/lib/auth/authorize";
import { recordInvestigationEvent } from "@/lib/investigations/investigation-audit";
import { queueInvestigationNotification } from "@/lib/repositories/investigation-notification-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type {
  InvestigationCase,
  InvestigationStatus,
  InvestigationOutcome,
  InvestigationCategory,
  InvestigationSource,
  InvestigationConfidentiality,
  ExceptionSeverity,
  InvestigationPartyRole,
  InvestigationNoteType,
  InvestigationTaskStatus,
} from "@/generated/prisma/client";

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002" &&
    JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target)
  );
}

/** Best-effort — a notification failure must never fail or roll back the underlying case action (P11N). */
async function notifyBestEffort(input: Parameters<typeof queueInvestigationNotification>[0]) {
  try {
    await queueInvestigationNotification(input);
  } catch {
    // Swallowed deliberately — the InvestigationNotificationRecord row (or its
    // absence, if the DB write itself failed) is not this call's concern;
    // the case action it accompanies has already succeeded.
  }
}

export class InvestigationCaseNotFoundError extends Error {
  constructor() {
    super("Investigation case not found.");
    this.name = "InvestigationCaseNotFoundError";
  }
}
export class InvalidCaseTransitionError extends Error {
  constructor(from: InvestigationStatus, to: InvestigationStatus) {
    super(`Cannot move an investigation case from ${from} to ${to}.`);
    this.name = "InvalidCaseTransitionError";
  }
}
export class CaseClosureRequirementsNotMetError extends Error {
  constructor(reasons: string[]) {
    super(`This case cannot be closed yet: ${reasons.join(" ")}`);
    this.name = "CaseClosureRequirementsNotMetError";
  }
}
export class SeparationOfDutiesViolationError extends Error {
  constructor() {
    super("The same user investigated, approved and is now attempting to close this high-severity case. An additional authorised reviewer is required.");
    this.name = "SeparationOfDutiesViolationError";
  }
}
export class SubjectNotFoundError extends Error {
  constructor() {
    super("Investigation subject not found.");
    this.name = "SubjectNotFoundError";
  }
}
export class NoteNotFoundError extends Error {
  constructor() {
    super("Investigation note not found.");
    this.name = "NoteNotFoundError";
  }
}
export class NoteAlreadyAmendedError extends Error {
  constructor() {
    super("This note has already been amended once — amend the correction record instead of the original.");
    this.name = "NoteAlreadyAmendedError";
  }
}
export class TaskNotFoundError extends Error {
  constructor() {
    super("Investigation task not found.");
    this.name = "TaskNotFoundError";
  }
}

/** Idempotent — creates the tenant's settings row on first use, same pattern as getPlatformBillingSettings(). */
export async function getOrCreateTenantInvestigationSettings(tenantId: string) {
  try {
    return await prisma.tenantInvestigationSettings.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "tenantId")) {
      return prisma.tenantInvestigationSettings.findUniqueOrThrow({ where: { tenantId } });
    }
    throw err;
  }
}

export async function updateTenantInvestigationSettings(
  session: AuthenticatedSession,
  input: { casePrefix?: string; enforceSeparationOfDuties?: boolean; requireDualApprovalForHighSeverityHoldRelease?: boolean },
) {
  await requirePermission(session, "investigationCase", "CONFIGURE");
  await getOrCreateTenantInvestigationSettings(session.tenantId);
  return prisma.tenantInvestigationSettings.update({
    where: { tenantId: session.tenantId },
    data: {
      casePrefix: input.casePrefix,
      enforceSeparationOfDuties: input.enforceSeparationOfDuties,
      requireDualApprovalForHighSeverityHoldRelease: input.requireDualApprovalForHighSeverityHoldRelease,
    },
  });
}

/**
 * Atomically allocates the next sequential case number for this tenant/year
 * ("<prefix>-<year>-<6-digit sequence>") — a single Postgres native upsert
 * (INSERT ... ON CONFLICT (tenantId, year) DO UPDATE SET nextSequence =
 * nextSequence + 1 RETURNING ...), so two concurrent case-creation calls in
 * the same tenant/year can never receive the same number, including the
 * very first call of a new year (P11C). Mirrors
 * allocateNextInvoiceNumber()'s atomicity guarantee (platform-billing-
 * repository.ts) but scoped per-tenant/year instead of a single global
 * singleton.
 */
export async function allocateNextInvestigationCaseNumber(tenantId: string, year: number = new Date().getUTCFullYear()): Promise<string> {
  const settings = await getOrCreateTenantInvestigationSettings(tenantId);
  const updated = await prisma.investigationCaseSequence.upsert({
    where: { tenantId_year: { tenantId, year } },
    create: { tenantId, year, nextSequence: 2 },
    update: { nextSequence: { increment: 1 } },
  });
  const sequenceUsed = updated.nextSequence - 1;
  return `${settings.casePrefix}-${year}-${String(sequenceUsed).padStart(6, "0")}`;
}

const CASE_DETAIL_INCLUDE = {
  reportingPerson: { select: { id: true, name: true, email: true } },
  assignedInvestigator: { select: { id: true, name: true, email: true } },
  caseOwner: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  closedBy: { select: { id: true, name: true, email: true } },
  reopenedBy: { select: { id: true, name: true, email: true } },
} as const;

export interface CreateInvestigationCaseInput {
  title: string;
  description: string;
  source: InvestigationSource;
  category?: InvestigationCategory | null;
  priority?: ExceptionSeverity;
  confidentiality?: InvestigationConfidentiality;
  reportingPersonUserId?: string | null;
  reportingPersonName?: string | null;
  caseOwnerUserId?: string | null;
}

/**
 * Permission-unchecked core — called by createInvestigationCase()
 * (investigationCase:CREATE, manual case creation) and by
 * investigation-referral-repository.ts (investigationReferral:CREATE, a
 * deliberately narrower permission so Gate Security Officer/Dispatch can
 * raise a referral without the broader case-management grant, P11K/P11M).
 */
export async function createInvestigationCaseInternal(session: AuthenticatedSession, input: CreateInvestigationCaseInput): Promise<InvestigationCase> {
  const caseNumber = await allocateNextInvestigationCaseNumber(session.tenantId);
  const created = await prisma.investigationCase.create({
    data: {
      tenantId: session.tenantId,
      caseNumber,
      title: input.title,
      description: input.description,
      source: input.source,
      category: input.category ?? null,
      priority: input.priority ?? "MEDIUM",
      confidentiality: input.confidentiality ?? "STANDARD",
      reportingPersonUserId: input.reportingPersonUserId ?? null,
      reportingPersonName: input.reportingPersonName ?? null,
      caseOwnerUserId: input.caseOwnerUserId ?? session.userId,
      createdByUserId: session.userId,
      evidenceHoldActive: true,
    },
    include: CASE_DETAIL_INCLUDE,
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: created.id,
    actorUserId: session.userId,
    action: "investigation.caseOpened",
    description: `Case ${created.caseNumber} opened (source: ${input.source}).`,
    afterValue: { caseNumber: created.caseNumber, source: input.source, title: input.title },
  });

  return created;
}

export async function createInvestigationCase(session: AuthenticatedSession, input: CreateInvestigationCaseInput): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "CREATE");
  return createInvestigationCaseInternal(session, input);
}

export async function getInvestigationCaseInTenant(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  const record = await prisma.investigationCase.findFirst({
    where: tenantWhere(session.tenantId, { id: caseId }),
    include: CASE_DETAIL_INCLUDE,
  });
  if (!record) return null;

  const canSeeConfidential = await hasPermission(session, "investigationConfidentialAccess", "VIEW");
  if (record.confidentiality !== "STANDARD" && !canSeeConfidential) {
    // Neutral-wording partial view: existence/status visible, sensitive
    // narrative content withheld (P11E "must not expose confidential info
    // to ordinary Dispatch/Security users").
    return { ...record, description: "[Confidential — access restricted]", reportingPersonName: null };
  }
  return record;
}

export interface ListInvestigationCasesFilter {
  status?: InvestigationStatus;
  assignedInvestigatorUserId?: string;
  search?: string;
}

export async function listInvestigationCasesInTenant(session: AuthenticatedSession, filter: ListInvestigationCasesFilter = {}) {
  await requirePermission(session, "investigationCase", "VIEW");
  return prisma.investigationCase.findMany({
    where: tenantWhere(session.tenantId, {
      status: filter.status,
      assignedInvestigatorUserId: filter.assignedInvestigatorUserId,
      ...(filter.search
        ? { OR: [{ title: { contains: filter.search, mode: "insensitive" as const } }, { caseNumber: { contains: filter.search, mode: "insensitive" as const } }] }
        : {}),
    }),
    orderBy: { createdAt: "desc" },
    include: CASE_DETAIL_INCLUDE,
  });
}

// DRAFT and OPEN are folded together as "not yet triaged" for transition
// purposes; TRIAGE is the deliberate checkpoint before work begins.
const VALID_TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = {
  DRAFT: ["OPEN", "TRIAGE"],
  OPEN: ["TRIAGE", "UNDER_INVESTIGATION"],
  TRIAGE: ["UNDER_INVESTIGATION", "OPEN"],
  UNDER_INVESTIGATION: ["AWAITING_INFORMATION", "AWAITING_APPROVAL"],
  AWAITING_INFORMATION: ["UNDER_INVESTIGATION"],
  AWAITING_APPROVAL: ["UNDER_INVESTIGATION", "CLOSED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["UNDER_INVESTIGATION", "TRIAGE"],
};

async function transitionCaseStatus(
  session: AuthenticatedSession,
  caseId: string,
  to: InvestigationStatus,
  action: string,
  description: string,
  extraData: Record<string, unknown> = {},
): Promise<InvestigationCase> {
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();
  if (!VALID_TRANSITIONS[existing.status]?.includes(to)) {
    throw new InvalidCaseTransitionError(existing.status, to);
  }

  const updated = await prisma.investigationCase.update({
    where: { id: caseId },
    data: { status: to, ...extraData },
    include: CASE_DETAIL_INCLUDE,
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action,
    description,
    beforeValue: { status: existing.status },
    afterValue: { status: to },
  });

  return updated;
}

export async function submitInvestigationCase(session: AuthenticatedSession, caseId: string): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "EDIT");
  return transitionCaseStatus(session, caseId, "OPEN", "investigation.caseSubmitted", "Case submitted for triage.", { submittedAt: new Date() });
}

export async function triageInvestigationCase(
  session: AuthenticatedSession,
  caseId: string,
  input: { category?: InvestigationCategory | null; priority?: ExceptionSeverity },
): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "EDIT");
  return transitionCaseStatus(session, caseId, "TRIAGE", "investigation.caseTriaged", "Case triaged.", {
    triagedAt: new Date(),
    category: input.category,
    priority: input.priority,
  });
}

/** Raises a case's priority (typically to HIGH/CRITICAL) without a status transition, and notifies the case owner (P11D "escalate", P11N). */
export async function escalateInvestigationCase(session: AuthenticatedSession, caseId: string, priority: ExceptionSeverity, reason: string): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "EDIT");
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();

  const updated = await prisma.investigationCase.update({ where: { id: caseId }, data: { priority }, include: CASE_DETAIL_INCLUDE });
  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.caseEscalated",
    description: `Case escalated to ${priority}: ${reason}`,
    reason,
    beforeValue: { priority: existing.priority },
    afterValue: { priority },
  });
  await notifyBestEffort({
    tenantId: session.tenantId,
    caseId,
    eventType: "ESCALATION",
    recipientUserId: updated.caseOwnerUserId,
    message: `Case ${updated.caseNumber} escalated to ${priority}: ${reason}`,
  });
  return updated;
}

export async function assignInvestigator(session: AuthenticatedSession, caseId: string, investigatorUserId: string): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "EDIT");
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();

  const updated = await prisma.investigationCase.update({
    where: { id: caseId },
    data: { assignedInvestigatorUserId: investigatorUserId },
    include: CASE_DETAIL_INCLUDE,
  });
  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: existing.assignedInvestigatorUserId ? "investigation.caseReassigned" : "investigation.caseAssigned",
    description: existing.assignedInvestigatorUserId ? "Investigator reassigned." : "Investigator assigned.",
    beforeValue: { assignedInvestigatorUserId: existing.assignedInvestigatorUserId },
    afterValue: { assignedInvestigatorUserId: investigatorUserId },
  });
  await notifyBestEffort({
    tenantId: session.tenantId,
    caseId,
    eventType: "ASSIGNMENT",
    recipientUserId: investigatorUserId,
    message: `You have been assigned to investigation case ${updated.caseNumber}.`,
  });
  return updated;
}

export async function beginInvestigation(session: AuthenticatedSession, caseId: string): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "EDIT");
  return transitionCaseStatus(session, caseId, "UNDER_INVESTIGATION", "investigation.investigationStarted", "Active investigation began.");
}

export async function requestInformation(session: AuthenticatedSession, caseId: string, reason: string): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "EDIT");
  const updated = await transitionCaseStatus(session, caseId, "AWAITING_INFORMATION", "investigation.informationRequested", `Awaiting information: ${reason}`);
  if (updated.reportingPersonUserId) {
    await notifyBestEffort({
      tenantId: session.tenantId,
      caseId,
      eventType: "INFORMATION_REQUESTED",
      recipientUserId: updated.reportingPersonUserId,
      message: `Additional information requested on case ${updated.caseNumber}: ${reason}`,
    });
  }
  return updated;
}

export async function resumeInvestigation(session: AuthenticatedSession, caseId: string): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCase", "EDIT");
  return transitionCaseStatus(session, caseId, "UNDER_INVESTIGATION", "investigation.investigationResumed", "Investigation resumed.");
}

/** Called by investigation-finding-repository.ts after a finding is submitted for approval. */
export async function markCaseAwaitingApproval(session: AuthenticatedSession, caseId: string): Promise<InvestigationCase> {
  return transitionCaseStatus(session, caseId, "AWAITING_APPROVAL", "investigation.caseAwaitingApproval", "Case awaiting finding approval.");
}

/** Called by investigation-finding-repository.ts after a finding is rejected/returned. */
export async function returnCaseToInvestigation(session: AuthenticatedSession, caseId: string): Promise<InvestigationCase> {
  return transitionCaseStatus(session, caseId, "UNDER_INVESTIGATION", "investigation.caseReturnedToInvestigation", "Finding returned — case reopened for further work.");
}

export interface CloseInvestigationCaseInput {
  approvedFindingId: string;
}

/**
 * Closure requires (P11D hard requirement): an APPROVED finding recorded
 * (supplies the outcome and finding summary), an authorised closing user, a
 * closure date, and an audit record — all four are set together here, never
 * independently. Enforces the configurable separation-of-duties policy for
 * HIGH/CRITICAL-priority cases (P11D): the same user cannot have been the
 * assigned investigator, the finding's approver, AND the closer.
 */
export async function closeInvestigationCase(session: AuthenticatedSession, caseId: string, input: CloseInvestigationCaseInput): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCaseClosure", "APPROVE");

  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();
  if (existing.status !== "AWAITING_APPROVAL") throw new InvalidCaseTransitionError(existing.status, "CLOSED");

  const finding = await prisma.investigationFinding.findFirst({
    where: tenantWhere(session.tenantId, { id: input.approvedFindingId, caseId }),
  });
  const reasons: string[] = [];
  if (!finding) reasons.push("No matching finding was found.");
  else if (finding.status !== "APPROVED") reasons.push("The finding has not been approved.");
  if (reasons.length > 0) throw new CaseClosureRequirementsNotMetError(reasons);

  const settings = await getOrCreateTenantInvestigationSettings(session.tenantId);
  if (settings.enforceSeparationOfDuties && (existing.priority === "HIGH" || existing.priority === "CRITICAL")) {
    const approval = await prisma.investigationApproval.findFirst({
      where: { tenantId: session.tenantId, findingId: input.approvedFindingId, action: "APPROVE" },
      orderBy: { createdAt: "desc" },
    });
    const sameActorInvestigatedAndApproved = existing.assignedInvestigatorUserId === session.userId && approval?.actorUserId === session.userId;
    if (sameActorInvestigatedAndApproved) throw new SeparationOfDutiesViolationError();
  }

  const updated = await prisma.investigationCase.update({
    where: { id: caseId },
    data: {
      status: "CLOSED",
      outcome: finding!.outcome,
      closedAt: new Date(),
      closedByUserId: session.userId,
    },
    include: CASE_DETAIL_INCLUDE,
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.caseClosed",
    description: `Case closed with outcome ${finding!.outcome}.`,
    beforeValue: { status: existing.status },
    afterValue: { status: "CLOSED", outcome: finding!.outcome },
  });

  for (const recipientUserId of new Set([updated.caseOwnerUserId, updated.assignedInvestigatorUserId].filter((id): id is string => !!id))) {
    await notifyBestEffort({
      tenantId: session.tenantId,
      caseId,
      eventType: "CLOSURE",
      recipientUserId,
      message: `Case ${updated.caseNumber} has been closed (outcome: ${finding!.outcome}).`,
    });
  }

  return updated;
}

export async function reopenInvestigationCase(session: AuthenticatedSession, caseId: string, reopenReason: string): Promise<InvestigationCase> {
  await requirePermission(session, "investigationCaseClosure", "REJECT");
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();
  if (existing.status !== "CLOSED") throw new InvalidCaseTransitionError(existing.status, "REOPENED");

  const updated = await prisma.investigationCase.update({
    where: { id: caseId },
    data: { status: "REOPENED", reopenedAt: new Date(), reopenedByUserId: session.userId, reopenReason },
    include: CASE_DETAIL_INCLUDE,
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.caseReopened",
    description: `Case reopened: ${reopenReason}`,
    reason: reopenReason,
    beforeValue: { status: "CLOSED" },
    afterValue: { status: "REOPENED" },
  });

  return updated;
}

// --- Related-record linking (P11B) -----------------------------------------

export interface LinkRelatedRecordInput {
  recordType:
    | "EXCEPTION"
    | "GATE_EVENT"
    | "GATE_EVENT_INSPECTION_ITEM"
    | "MOVEMENT_AUTHORISATION"
    | "RECONCILIATION"
    | "RECONCILIATION_DISCREPANCY"
    | "FACIAL_VERIFICATION_ATTEMPT"
    | "TELEMATICS_EVENT"
    | "VEHICLE"
    | "DRIVER"
    | "OTHER";
  recordId: string;
  snapshotSummary: Record<string, unknown>;
  isReferralSource?: boolean;
}

/** Links WITHOUT modifying the source record (P11B hard requirement) — purely an immutable pointer + display snapshot. */
/** Permission-unchecked core, shared with investigation-referral-repository.ts (see createInvestigationCaseInternal's comment for why). */
export async function linkRelatedRecordInternal(session: AuthenticatedSession, caseId: string, input: LinkRelatedRecordInput) {
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();

  const created = await prisma.investigationRelatedRecord.create({
    data: {
      tenantId: session.tenantId,
      caseId,
      recordType: input.recordType,
      recordId: input.recordId,
      snapshotSummary: input.snapshotSummary as object,
      isReferralSource: input.isReferralSource ?? false,
      linkedByUserId: session.userId,
    },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.relatedRecordLinked",
    description: `Linked ${input.recordType} record.`,
    metadata: { recordType: input.recordType, recordId: input.recordId },
  });

  return created;
}

export async function linkRelatedRecord(session: AuthenticatedSession, caseId: string, input: LinkRelatedRecordInput) {
  await requirePermission(session, "investigationCase", "EDIT");
  return linkRelatedRecordInternal(session, caseId, input);
}

export async function listRelatedRecords(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  return prisma.investigationRelatedRecord.findMany({ where: tenantWhere(session.tenantId, { caseId }), orderBy: { linkedAt: "asc" } });
}

// --- Subjects (P11E) ---------------------------------------------------------

export interface AddSubjectInput {
  role: InvestigationPartyRole;
  userId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  contractorName?: string | null;
  department?: string | null;
  site?: string | null;
  notes?: string | null;
}

export async function addInvestigationSubject(session: AuthenticatedSession, caseId: string, input: AddSubjectInput) {
  await requirePermission(session, "investigationSubject", "EDIT");
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();

  const created = await prisma.investigationSubject.create({
    data: {
      tenantId: session.tenantId,
      caseId,
      role: input.role,
      userId: input.userId ?? null,
      driverId: input.driverId ?? null,
      vehicleId: input.vehicleId ?? null,
      contractorName: input.contractorName ?? null,
      department: input.department ?? null,
      site: input.site ?? null,
      notes: input.notes ?? null,
      createdByUserId: session.userId,
    },
  });

  // Neutral language — always "case subject", never a guilt-implying label.
  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.subjectLinked",
    description: `Linked a case ${input.role.toLowerCase()}.`,
  });

  return created;
}

export async function recordSubjectResponse(session: AuthenticatedSession, subjectId: string, explanationResponse: string) {
  await requirePermission(session, "investigationSubject", "EDIT");
  const subject = await prisma.investigationSubject.findFirst({ where: tenantWhere(session.tenantId, { id: subjectId }) });
  if (!subject) throw new SubjectNotFoundError();

  const updated = await prisma.investigationSubject.update({
    where: { id: subjectId },
    data: { explanationResponse, explanationRespondedAt: new Date() },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: subject.caseId,
    actorUserId: session.userId,
    action: "investigation.subjectResponseRecorded",
    description: "Recorded a case subject's explanation/response.",
    entityType: "InvestigationSubject",
    entityId: subjectId,
  });

  return updated;
}

export async function listInvestigationSubjects(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  return prisma.investigationSubject.findMany({
    where: tenantWhere(session.tenantId, { caseId }),
    include: { user: { select: { id: true, name: true } }, driver: { select: { id: true, name: true } }, vehicle: { select: { id: true, registrationNumber: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// --- Notes (P11H, append-only) ----------------------------------------------

export interface AddNoteInput {
  content: string;
  noteType?: InvestigationNoteType;
  confidentiality?: InvestigationConfidentiality;
}

export async function addInvestigationNote(session: AuthenticatedSession, caseId: string, input: AddNoteInput) {
  await requirePermission(session, "investigationNote", "CREATE");
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();

  const created = await prisma.investigationNote.create({
    data: {
      tenantId: session.tenantId,
      caseId,
      authorUserId: session.userId,
      content: input.content,
      noteType: input.noteType ?? "GENERAL",
      confidentiality: input.confidentiality ?? "STANDARD",
    },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.noteAdded",
    description: `Note added (${created.noteType}).`,
    entityType: "InvestigationNote",
    entityId: created.id,
  });

  return created;
}

/** Never edits the original — always a new row referencing supersedesNoteId (P11H hard requirement). */
export async function amendInvestigationNote(session: AuthenticatedSession, noteId: string, content: string) {
  await requirePermission(session, "investigationNote", "CREATE");
  const original = await prisma.investigationNote.findFirst({ where: tenantWhere(session.tenantId, { id: noteId }) });
  if (!original) throw new NoteNotFoundError();

  const existingAmendment = await prisma.investigationNote.findUnique({ where: { supersedesNoteId: noteId } });
  if (existingAmendment) throw new NoteAlreadyAmendedError();

  const amendment = await prisma.investigationNote.create({
    data: {
      tenantId: session.tenantId,
      caseId: original.caseId,
      authorUserId: session.userId,
      content,
      noteType: original.noteType,
      confidentiality: original.confidentiality,
      supersedesNoteId: noteId,
    },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: original.caseId,
    actorUserId: session.userId,
    action: "investigation.noteAmended",
    description: "A note was amended/corrected — original preserved.",
    entityType: "InvestigationNote",
    entityId: amendment.id,
    metadata: { supersedesNoteId: noteId },
  });

  return amendment;
}

export async function listInvestigationNotes(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  const canSeeRestricted = await hasPermission(session, "investigationNote", "VIEW");
  const notes = await prisma.investigationNote.findMany({
    where: tenantWhere(session.tenantId, { caseId }),
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (canSeeRestricted) return notes;
  return notes.filter((n) => n.confidentiality === "STANDARD");
}

// --- Tasks (P11H) ------------------------------------------------------------

export interface CreateTaskInput {
  description: string;
  assignedToUserId: string;
  dueDate?: Date | null;
}

export async function createInvestigationTask(session: AuthenticatedSession, caseId: string, input: CreateTaskInput) {
  await requirePermission(session, "investigationTask", "CREATE");
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();

  const created = await prisma.investigationTask.create({
    data: {
      tenantId: session.tenantId,
      caseId,
      description: input.description,
      assignedToUserId: input.assignedToUserId,
      dueDate: input.dueDate ?? null,
      createdByUserId: session.userId,
    },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.taskCreated",
    description: `Task created: ${input.description}`,
    entityType: "InvestigationTask",
    entityId: created.id,
  });

  return created;
}

export interface UpdateTaskInput {
  status?: InvestigationTaskStatus;
  completionNote?: string | null;
}

export async function updateInvestigationTask(session: AuthenticatedSession, taskId: string, input: UpdateTaskInput) {
  await requirePermission(session, "investigationTask", "EDIT");
  const task = await prisma.investigationTask.findFirst({ where: tenantWhere(session.tenantId, { id: taskId }) });
  if (!task) throw new TaskNotFoundError();

  const isCompleting = input.status === "DONE";
  const updated = await prisma.investigationTask.update({
    where: { id: taskId },
    data: {
      status: input.status,
      completionNote: input.completionNote,
      completedByUserId: isCompleting ? session.userId : task.completedByUserId,
      completedAt: isCompleting ? new Date() : task.completedAt,
    },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: task.caseId,
    actorUserId: session.userId,
    action: "investigation.taskUpdated",
    description: `Task status changed to ${input.status ?? task.status}.`,
    entityType: "InvestigationTask",
    entityId: taskId,
  });

  return updated;
}

export async function listInvestigationTasks(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  return prisma.investigationTask.findMany({
    where: tenantWhere(session.tenantId, { caseId }),
    include: { assignedTo: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function listOverdueInvestigationTasks(tenantId: string, now: Date = new Date()) {
  return prisma.investigationTask.findMany({
    where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: now } },
    include: { case: { select: { id: true, caseNumber: true, title: true } }, assignedTo: { select: { id: true, name: true, email: true } } },
  });
}

export async function listChronology(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  return prisma.investigationChronologyEvent.findMany({
    where: tenantWhere(session.tenantId, { caseId }),
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { occurredAt: "asc" },
  });
}

export interface InvestigationDashboardCounts {
  byStatus: Partial<Record<InvestigationStatus, number>>;
  byPriority: Partial<Record<ExceptionSeverity, number>>;
  overdueTaskCount: number;
  awaitingApprovalCount: number;
  activeHoldCount: number;
  recentlyUpdated: InvestigationCase[];
}

/** Aggregate operational counts only (P11K/P11P) — never a per-employee risk score or cross-tenant comparison. */
export async function getInvestigationDashboardCounts(session: AuthenticatedSession): Promise<InvestigationDashboardCounts> {
  await requirePermission(session, "investigationCase", "VIEW");
  const [statusGroups, priorityGroups, overdueTaskCount, activeHoldCount, recentlyUpdated] = await Promise.all([
    prisma.investigationCase.groupBy({ by: ["status"], where: { tenantId: session.tenantId }, _count: true }),
    prisma.investigationCase.groupBy({ by: ["priority"], where: { tenantId: session.tenantId }, _count: true }),
    prisma.investigationTask.count({ where: { tenantId: session.tenantId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() } } }),
    prisma.investigationCase.count({ where: { tenantId: session.tenantId, evidenceHoldActive: true } }),
    prisma.investigationCase.findMany({ where: { tenantId: session.tenantId }, orderBy: { updatedAt: "desc" }, take: 10, include: CASE_DETAIL_INCLUDE }),
  ]);

  const byStatus: Partial<Record<InvestigationStatus, number>> = {};
  for (const g of statusGroups) byStatus[g.status] = g._count;
  const byPriority: Partial<Record<ExceptionSeverity, number>> = {};
  for (const g of priorityGroups) byPriority[g.priority] = g._count;

  return {
    byStatus,
    byPriority,
    overdueTaskCount,
    awaitingApprovalCount: byStatus.AWAITING_APPROVAL ?? 0,
    activeHoldCount,
    recentlyUpdated,
  };
}

export type { InvestigationStatus, InvestigationOutcome };
