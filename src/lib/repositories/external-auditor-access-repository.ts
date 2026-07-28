import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordInvestigationEvent } from "@/lib/investigations/investigation-audit";
import { getDefaultAuditorInvitationProvider } from "@/lib/investigations/auditor-invitation-provider";
import { queueInvestigationNotification } from "@/lib/repositories/investigation-notification-repository";
import { mintSignedUrlForMediaAsset } from "@/lib/repositories/media-asset-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";

const EXTERNAL_AUDITOR_ROLE_NAME = "External Auditor (Case-Scoped)";

export class AuditorUserNotEligibleError extends Error {
  constructor() {
    super(`The target user must hold the "${EXTERNAL_AUDITOR_ROLE_NAME}" role — a user with broader platform permissions cannot be granted this restricted access mechanism.`);
    this.name = "AuditorUserNotEligibleError";
  }
}
export class GrantCaseNotInTenantError extends Error {
  constructor() {
    super("One or more of the specified cases were not found in this tenant.");
    this.name = "GrantCaseNotInTenantError";
  }
}
export class GrantNotFoundError extends Error {
  constructor() {
    super("External-auditor access grant not found.");
    this.name = "GrantNotFoundError";
  }
}
export class GrantAlreadyRevokedError extends Error {
  constructor() {
    super("This grant has already been revoked.");
    this.name = "GrantAlreadyRevokedError";
  }
}
export class AuditorAccessDeniedError extends Error {
  constructor() {
    super("No active access grant permits this external auditor to view this case.");
    this.name = "AuditorAccessDeniedError";
  }
}
export class DownloadNotPermittedByGrantError extends Error {
  constructor(kind: "report" | "evidence") {
    super(`This grant does not permit downloading ${kind}.`);
    this.name = "DownloadNotPermittedByGrantError";
  }
}

export interface CreateGrantInput {
  externalAuditorUserId: string;
  caseIds: string[];
  reason: string;
  expiresAt: Date;
  canDownloadReport?: boolean;
  canDownloadEvidence?: boolean;
}

/**
 * Grants restricted, case-scoped, time-limited external-auditor access
 * (P11L) — deliberately requires the target user to already hold the
 * dedicated "External Auditor (Case-Scoped)" role (no general tenant-wide
 * permission, see prisma/seed.ts), and requires an explicit reason and
 * expiry. Sends a best-effort notification via the honest
 * NoOp/deterministic-Mock invitation provider — never a real external
 * email — and the grant is fully functional even if that notification
 * fails or is a no-op (the audit-visible grant record is the source of
 * truth, not the notification).
 */
export async function grantExternalAuditorAccess(session: AuthenticatedSession, input: CreateGrantInput) {
  await requirePermission(session, "externalAuditorAccess", "CREATE");

  const auditorUser = await prisma.user.findFirst({
    where: tenantWhere(session.tenantId, { id: input.externalAuditorUserId }),
    include: { role: true },
  });
  if (!auditorUser || auditorUser.role.name !== EXTERNAL_AUDITOR_ROLE_NAME) throw new AuditorUserNotEligibleError();

  const cases = await prisma.investigationCase.findMany({ where: tenantWhere(session.tenantId, { id: { in: input.caseIds } }) });
  if (cases.length !== input.caseIds.length) throw new GrantCaseNotInTenantError();

  const grant = await prisma.externalAuditorAccessGrant.create({
    data: {
      tenantId: session.tenantId,
      externalAuditorUserId: input.externalAuditorUserId,
      grantedByUserId: session.userId,
      reason: input.reason,
      canDownloadReport: input.canDownloadReport ?? false,
      canDownloadEvidence: input.canDownloadEvidence ?? false,
      expiresAt: input.expiresAt,
      cases: { create: cases.map((c) => ({ caseId: c.id })) },
    },
  });

  for (const c of cases) {
    await recordInvestigationEvent({
      tenantId: session.tenantId,
      caseId: c.id,
      actorUserId: session.userId,
      action: "investigation.externalAccessGranted",
      description: `External-auditor access granted to ${auditorUser.email}, expires ${input.expiresAt.toISOString()}.`,
      reason: input.reason,
      entityType: "ExternalAuditorAccessGrant",
      entityId: grant.id,
    });
    try {
      await queueInvestigationNotification({
        tenantId: session.tenantId,
        caseId: c.id,
        eventType: "EXTERNAL_ACCESS_GRANTED",
        recipientUserId: input.externalAuditorUserId,
        message: `You have been granted access to case ${c.caseNumber}, expiring ${input.expiresAt.toISOString()}.`,
      });
    } catch {
      // Best-effort — see investigation-case-repository.ts's notifyBestEffort comment.
    }
  }

  const grantedByUser = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
  const provider = getDefaultAuditorInvitationProvider();
  await provider.send({
    toEmail: auditorUser.email,
    auditorName: auditorUser.name,
    caseNumbers: cases.map((c) => c.caseNumber),
    grantedByName: grantedByUser?.name ?? "-",
    expiresAt: input.expiresAt,
    portalUrl: "/external-auditor",
  });

  return grant;
}

export async function revokeExternalAuditorAccess(session: AuthenticatedSession, grantId: string, reason: string) {
  await requirePermission(session, "externalAuditorAccess", "DELETE");
  const grant = await prisma.externalAuditorAccessGrant.findFirst({ where: tenantWhere(session.tenantId, { id: grantId }), include: { cases: true } });
  if (!grant) throw new GrantNotFoundError();
  if (grant.revokedAt) throw new GrantAlreadyRevokedError();

  const updated = await prisma.externalAuditorAccessGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date(), revokedByUserId: session.userId, revokedReason: reason },
  });

  for (const gc of grant.cases) {
    await recordInvestigationEvent({
      tenantId: session.tenantId,
      caseId: gc.caseId,
      actorUserId: session.userId,
      action: "investigation.externalAccessRevoked",
      description: `External-auditor access revoked: ${reason}`,
      reason,
      entityType: "ExternalAuditorAccessGrant",
      entityId: grantId,
    });
    try {
      await queueInvestigationNotification({
        tenantId: session.tenantId,
        caseId: gc.caseId,
        eventType: "EXTERNAL_ACCESS_REVOKED",
        recipientUserId: grant.externalAuditorUserId,
        message: `Your access to this case has been revoked: ${reason}`,
      });
    } catch {
      // Best-effort — see investigation-case-repository.ts's notifyBestEffort comment.
    }
  }

  return updated;
}

export async function listExternalAuditorAccessGrants(session: AuthenticatedSession, caseId?: string) {
  await requirePermission(session, "externalAuditorAccess", "VIEW");
  return prisma.externalAuditorAccessGrant.findMany({
    where: {
      tenantId: session.tenantId,
      ...(caseId ? { cases: { some: { caseId } } } : {}),
    },
    include: {
      externalAuditor: { select: { id: true, name: true, email: true } },
      grantedBy: { select: { id: true, name: true } },
      revokedBy: { select: { id: true, name: true } },
      cases: { include: { case: { select: { id: true, caseNumber: true, title: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// --- External-auditor-facing portal functions --------------------------------

async function getActiveGrantForCase(session: AuthenticatedSession, caseId: string, now: Date = new Date()) {
  return prisma.externalAuditorAccessGrant.findFirst({
    where: {
      tenantId: session.tenantId,
      externalAuditorUserId: session.userId,
      revokedAt: null,
      startAt: { lte: now },
      expiresAt: { gt: now },
      cases: { some: { caseId } },
    },
  });
}

async function logAuditorAccess(session: AuthenticatedSession, grantId: string, caseId: string, action: string) {
  await prisma.externalAuditorAccessLog.create({
    data: { tenantId: session.tenantId, grantId, caseId, actorUserId: session.userId, action },
  });
}

/** Every case an external auditor's currently-active grants permit — the only listing surface their session can ever use. */
export async function listPermittedCasesForAuditor(session: AuthenticatedSession) {
  await requirePermission(session, "externalAuditorPortal", "VIEW");
  const now = new Date();
  const grants = await prisma.externalAuditorAccessGrant.findMany({
    where: { tenantId: session.tenantId, externalAuditorUserId: session.userId, revokedAt: null, startAt: { lte: now }, expiresAt: { gt: now } },
    include: { cases: { include: { case: true } } },
  });
  const seen = new Map<string, (typeof grants)[number]["cases"][number]["case"]>();
  for (const grant of grants) for (const gc of grant.cases) seen.set(gc.case.id, gc.case);
  return Array.from(seen.values());
}

/** Read-only, single-case view — re-verifies a live grant on every call (no session-cached authorisation), and logs the view (P11L hard requirement). */
export async function getCaseForAuditor(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "externalAuditorPortal", "VIEW");
  const grant = await getActiveGrantForCase(session, caseId);
  if (!grant) throw new AuditorAccessDeniedError();

  const investigationCase = await prisma.investigationCase.findFirst({
    where: tenantWhere(session.tenantId, { id: caseId }),
    include: { assignedInvestigator: { select: { name: true } } },
  });
  if (!investigationCase) throw new AuditorAccessDeniedError();

  await logAuditorAccess(session, grant.id, caseId, "VIEW_CASE");
  return investigationCase;
}

export async function getReportForAuditor(session: AuthenticatedSession, caseId: string, mediaAssetId: string) {
  await requirePermission(session, "externalAuditorPortal", "EXPORT");
  const grant = await getActiveGrantForCase(session, caseId);
  if (!grant) throw new AuditorAccessDeniedError();
  if (!grant.canDownloadReport) throw new DownloadNotPermittedByGrantError("report");

  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, tenantId: session.tenantId, ownerType: "INVESTIGATION_REPORT", ownerId: caseId } });
  if (!asset) throw new AuditorAccessDeniedError();

  await logAuditorAccess(session, grant.id, caseId, "DOWNLOAD_REPORT");
  return mintSignedUrlForMediaAsset(session.tenantId, session.userId, mediaAssetId);
}

export async function getEvidenceForAuditor(session: AuthenticatedSession, caseId: string, evidenceLinkId: string) {
  await requirePermission(session, "externalAuditorPortal", "EXPORT");
  const grant = await getActiveGrantForCase(session, caseId);
  if (!grant) throw new AuditorAccessDeniedError();
  if (!grant.canDownloadEvidence) throw new DownloadNotPermittedByGrantError("evidence");

  const link = await prisma.investigationEvidenceLink.findFirst({ where: tenantWhere(session.tenantId, { id: evidenceLinkId, caseId }) });
  if (!link) throw new AuditorAccessDeniedError();

  await logAuditorAccess(session, grant.id, caseId, "DOWNLOAD_EVIDENCE");
  return mintSignedUrlForMediaAsset(session.tenantId, session.userId, link.mediaAssetId);
}

export async function listAccessLogsForGrant(session: AuthenticatedSession, grantId: string) {
  await requirePermission(session, "externalAuditorAccess", "VIEW");
  const grant = await prisma.externalAuditorAccessGrant.findFirst({ where: tenantWhere(session.tenantId, { id: grantId }) });
  if (!grant) throw new GrantNotFoundError();
  return prisma.externalAuditorAccessLog.findMany({ where: { tenantId: session.tenantId, grantId }, orderBy: { occurredAt: "desc" } });
}
