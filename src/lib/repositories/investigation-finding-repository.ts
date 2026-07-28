import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordInvestigationEvent } from "@/lib/investigations/investigation-audit";
import { InvestigationCaseNotFoundError, getOrCreateTenantInvestigationSettings, markCaseAwaitingApproval, returnCaseToInvestigation } from "@/lib/repositories/investigation-case-repository";
import { queueInvestigationNotification } from "@/lib/repositories/investigation-notification-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { InvestigationOutcome } from "@/generated/prisma/client";

export class FindingNotFoundError extends Error {
  constructor() {
    super("Investigation finding not found.");
    this.name = "FindingNotFoundError";
  }
}
export class FindingNotEditableError extends Error {
  constructor() {
    super("Only a DRAFT finding can be edited in place — submit an amended version instead.");
    this.name = "FindingNotEditableError";
  }
}
export class FindingNotSubmittableError extends Error {
  constructor() {
    super("Only a DRAFT finding can be submitted for approval.");
    this.name = "FindingNotSubmittableError";
  }
}
export class FindingNotPendingApprovalError extends Error {
  constructor() {
    super("This finding is not awaiting an approval decision.");
    this.name = "FindingNotPendingApprovalError";
  }
}
export class FindingNotAmendableError extends Error {
  constructor() {
    super("A new version can only be created from a RETURNED_FOR_AMENDMENT, REJECTED or APPROVED finding.");
    this.name = "FindingNotAmendableError";
  }
}
export class SameActorCannotApproveOwnFindingError extends Error {
  constructor() {
    super("The user who created or submitted this finding cannot also approve it.");
    this.name = "SameActorCannotApproveOwnFindingError";
  }
}

/** Best-effort — a notification failure must never fail or roll back the underlying finding action (P11N). */
async function notifyBestEffort(input: Parameters<typeof queueInvestigationNotification>[0]) {
  try {
    await queueInvestigationNotification(input);
  } catch {
    // Swallowed deliberately — see investigation-case-repository.ts's identical helper.
  }
}

export interface FindingFields {
  executiveSummary: string;
  detailedFindings: string;
  evidenceRelied?: string | null;
  contradictoryEvidence?: string | null;
  subjectResponseSummary?: string | null;
  outcome: InvestigationOutcome;
  recommendations?: string | null;
  correctiveActions?: string | null;
  controlWeaknesses?: string | null;
  followUpDate?: Date | null;
}

async function nextVersion(tenantId: string, caseId: string): Promise<number> {
  const last = await prisma.investigationFinding.findFirst({ where: tenantWhere(tenantId, { caseId }), orderBy: { version: "desc" } });
  return (last?.version ?? 0) + 1;
}

export async function createInvestigationFinding(session: AuthenticatedSession, caseId: string, fields: FindingFields) {
  await requirePermission(session, "investigationFinding", "CREATE");
  const activeCase = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!activeCase) throw new InvestigationCaseNotFoundError();

  const version = await nextVersion(session.tenantId, caseId);
  const created = await prisma.investigationFinding.create({
    data: { tenantId: session.tenantId, caseId, version, createdByUserId: session.userId, ...fields },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.findingDrafted",
    description: `Finding v${version} drafted.`,
    entityType: "InvestigationFinding",
    entityId: created.id,
  });

  return created;
}

export async function updateDraftFinding(session: AuthenticatedSession, findingId: string, fields: Partial<FindingFields>) {
  await requirePermission(session, "investigationFinding", "CREATE");
  const finding = await prisma.investigationFinding.findFirst({ where: tenantWhere(session.tenantId, { id: findingId }) });
  if (!finding) throw new FindingNotFoundError();
  if (finding.status !== "DRAFT") throw new FindingNotEditableError();

  return prisma.investigationFinding.update({ where: { id: findingId }, data: fields });
}

/** Only valid from RETURNED_FOR_AMENDMENT/REJECTED/APPROVED — always a NEW row, the prior version is never edited (P11I hard requirement). */
export async function createAmendedFindingVersion(session: AuthenticatedSession, findingId: string, fields: FindingFields) {
  await requirePermission(session, "investigationFinding", "EDIT");
  const original = await prisma.investigationFinding.findFirst({ where: tenantWhere(session.tenantId, { id: findingId }) });
  if (!original) throw new FindingNotFoundError();
  if (!["RETURNED_FOR_AMENDMENT", "REJECTED", "APPROVED"].includes(original.status)) throw new FindingNotAmendableError();

  const version = await nextVersion(session.tenantId, original.caseId);
  const created = await prisma.investigationFinding.create({
    data: { tenantId: session.tenantId, caseId: original.caseId, version, createdByUserId: session.userId, ...fields },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: original.caseId,
    actorUserId: session.userId,
    action: "investigation.findingAmended",
    description: `Finding amended into a new version (v${version}), preserving v${original.version}.`,
    entityType: "InvestigationFinding",
    entityId: created.id,
    metadata: { previousFindingId: original.id, previousVersion: original.version },
  });

  return created;
}

export async function submitFindingForApproval(session: AuthenticatedSession, findingId: string) {
  await requirePermission(session, "investigationFinding", "CREATE");
  const finding = await prisma.investigationFinding.findFirst({ where: tenantWhere(session.tenantId, { id: findingId }) });
  if (!finding) throw new FindingNotFoundError();
  if (finding.status !== "DRAFT") throw new FindingNotSubmittableError();

  const [updated] = await prisma.$transaction([
    prisma.investigationFinding.update({ where: { id: findingId }, data: { status: "SUBMITTED", submittedByUserId: session.userId, submittedAt: new Date() } }),
    prisma.investigationApproval.create({ data: { tenantId: session.tenantId, caseId: finding.caseId, findingId, action: "SUBMIT", actorUserId: session.userId } }),
  ]);

  await markCaseAwaitingApproval(session, finding.caseId);
  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: finding.caseId,
    actorUserId: session.userId,
    action: "investigation.findingSubmittedForApproval",
    description: `Finding v${finding.version} submitted for approval.`,
    entityType: "InvestigationFinding",
    entityId: findingId,
  });

  const caseRecord = await prisma.investigationCase.findUnique({ where: { id: finding.caseId } });
  if (caseRecord) {
    await notifyBestEffort({
      tenantId: session.tenantId,
      caseId: finding.caseId,
      eventType: "APPROVAL_REQUIRED",
      recipientUserId: caseRecord.caseOwnerUserId,
      message: `Finding v${finding.version} on case ${caseRecord.caseNumber} is awaiting your approval.`,
    });
  }

  return updated;
}

async function assertSeparationOfDuties(session: AuthenticatedSession, finding: { createdByUserId: string; submittedByUserId: string | null }) {
  const settings = await getOrCreateTenantInvestigationSettings(session.tenantId);
  if (!settings.enforceSeparationOfDuties) return;
  if (finding.createdByUserId === session.userId || finding.submittedByUserId === session.userId) {
    throw new SameActorCannotApproveOwnFindingError();
  }
}

export async function approveInvestigationFinding(session: AuthenticatedSession, findingId: string, reason?: string) {
  await requirePermission(session, "investigationFinding", "APPROVE");
  const finding = await prisma.investigationFinding.findFirst({ where: tenantWhere(session.tenantId, { id: findingId }) });
  if (!finding) throw new FindingNotFoundError();
  if (finding.status !== "SUBMITTED") throw new FindingNotPendingApprovalError();
  await assertSeparationOfDuties(session, finding);

  const [updated] = await prisma.$transaction([
    prisma.investigationFinding.update({ where: { id: findingId }, data: { status: "APPROVED" } }),
    prisma.investigationApproval.create({ data: { tenantId: session.tenantId, caseId: finding.caseId, findingId, action: "APPROVE", actorUserId: session.userId, reason } }),
  ]);

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: finding.caseId,
    actorUserId: session.userId,
    action: "investigation.findingApproved",
    description: `Finding v${finding.version} approved.`,
    reason,
    entityType: "InvestigationFinding",
    entityId: findingId,
  });

  return updated;
}

export async function returnFindingForAmendment(session: AuthenticatedSession, findingId: string, reason: string) {
  await requirePermission(session, "investigationFinding", "REJECT");
  const finding = await prisma.investigationFinding.findFirst({ where: tenantWhere(session.tenantId, { id: findingId }) });
  if (!finding) throw new FindingNotFoundError();
  if (finding.status !== "SUBMITTED") throw new FindingNotPendingApprovalError();

  const [updated] = await prisma.$transaction([
    prisma.investigationFinding.update({ where: { id: findingId }, data: { status: "RETURNED_FOR_AMENDMENT" } }),
    prisma.investigationApproval.create({ data: { tenantId: session.tenantId, caseId: finding.caseId, findingId, action: "RETURN_FOR_AMENDMENT", actorUserId: session.userId, reason } }),
  ]);

  await returnCaseToInvestigation(session, finding.caseId);
  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: finding.caseId,
    actorUserId: session.userId,
    action: "investigation.findingReturnedForAmendment",
    description: `Finding v${finding.version} returned for amendment: ${reason}`,
    reason,
    entityType: "InvestigationFinding",
    entityId: findingId,
  });

  await notifyBestEffort({
    tenantId: session.tenantId,
    caseId: finding.caseId,
    eventType: "APPROVAL_RETURNED",
    recipientUserId: finding.submittedByUserId ?? finding.createdByUserId,
    message: `Finding v${finding.version} was returned for amendment: ${reason}`,
  });

  return updated;
}

export async function rejectInvestigationFinding(session: AuthenticatedSession, findingId: string, reason: string) {
  await requirePermission(session, "investigationFinding", "REJECT");
  const finding = await prisma.investigationFinding.findFirst({ where: tenantWhere(session.tenantId, { id: findingId }) });
  if (!finding) throw new FindingNotFoundError();
  if (finding.status !== "SUBMITTED") throw new FindingNotPendingApprovalError();

  const [updated] = await prisma.$transaction([
    prisma.investigationFinding.update({ where: { id: findingId }, data: { status: "REJECTED" } }),
    prisma.investigationApproval.create({ data: { tenantId: session.tenantId, caseId: finding.caseId, findingId, action: "REJECT", actorUserId: session.userId, reason } }),
  ]);

  await returnCaseToInvestigation(session, finding.caseId);
  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: finding.caseId,
    actorUserId: session.userId,
    action: "investigation.findingRejected",
    description: `Finding v${finding.version} rejected: ${reason}`,
    reason,
    entityType: "InvestigationFinding",
    entityId: findingId,
  });

  await notifyBestEffort({
    tenantId: session.tenantId,
    caseId: finding.caseId,
    eventType: "APPROVAL_REJECTED",
    recipientUserId: finding.submittedByUserId ?? finding.createdByUserId,
    message: `Finding v${finding.version} was rejected: ${reason}`,
  });

  return updated;
}

export async function listInvestigationFindings(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  return prisma.investigationFinding.findMany({
    where: tenantWhere(session.tenantId, { caseId }),
    include: { createdBy: { select: { id: true, name: true } }, submittedBy: { select: { id: true, name: true } }, approvals: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } } },
    orderBy: { version: "asc" },
  });
}
