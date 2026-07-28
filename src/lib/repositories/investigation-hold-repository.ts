import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordInvestigationEvent } from "@/lib/investigations/investigation-audit";
import { setInvestigationHold } from "@/lib/repositories/retention-repository";
import { InvestigationCaseNotFoundError, getOrCreateTenantInvestigationSettings } from "@/lib/repositories/investigation-case-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";

export class HoldNotActiveError extends Error {
  constructor() {
    super("This case's evidence hold has already been released.");
    this.name = "HoldNotActiveError";
  }
}

/**
 * Result of a release attempt when dual approval applies — the caller must
 * show this to the user rather than treating it as a normal success, since
 * the hold has NOT actually been released yet (P11G: "consider dual
 * approval for high-severity/legally-sensitive holds").
 */
export interface HoldReleaseRequestedResult {
  released: false;
  requiresSecondApprover: true;
}

/**
 * Releases a case's evidence hold, sweeping every still-linked (non-
 * entered-in-error) MediaAsset's investigationHold flag — but only clearing
 * a given asset's flag if no OTHER case with an active hold still links it
 * (an asset can legitimately be cross-referenced by two cases). Closing a
 * case never calls this automatically (P11G hard requirement) — it is
 * always a separate, authorised, reasoned action.
 *
 * For HIGH/CRITICAL-priority cases, when the tenant's
 * requireDualApprovalForHighSeverityHoldRelease setting is on, this
 * requires two distinct authorised users: the first call records a request
 * (chronology only, hold NOT released) and returns
 * HoldReleaseRequestedResult; a second call from a *different* user
 * actually releases it.
 */
export async function releaseInvestigationHold(
  session: AuthenticatedSession,
  caseId: string,
  reason: string,
): Promise<HoldReleaseRequestedResult | { released: true; caseId: string }> {
  await requirePermission(session, "investigationHold", "CONFIGURE");

  const activeCase = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!activeCase) throw new InvestigationCaseNotFoundError();
  if (!activeCase.evidenceHoldActive) throw new HoldNotActiveError();

  const settings = await getOrCreateTenantInvestigationSettings(session.tenantId);
  const requiresDualApproval = settings.requireDualApprovalForHighSeverityHoldRelease && (activeCase.priority === "HIGH" || activeCase.priority === "CRITICAL");

  if (requiresDualApproval) {
    const priorRequest = await prisma.investigationChronologyEvent.findFirst({
      where: { tenantId: session.tenantId, caseId, eventType: "investigation.holdReleaseRequested" },
      orderBy: { occurredAt: "desc" },
    });
    // The hold is confirmed still active above, so any prior request found
    // here has not yet been consumed by an actual release — a second,
    // different user's call is what's needed to proceed.
    if (!priorRequest || priorRequest.actorUserId === session.userId) {
      await recordInvestigationEvent({
        tenantId: session.tenantId,
        caseId,
        actorUserId: session.userId,
        action: "investigation.holdReleaseRequested",
        description: `Hold release requested (high-severity case — a second, different authorised user must confirm): ${reason}`,
        reason,
      });
      return { released: false, requiresSecondApprover: true };
    }
  }

  await doReleaseHold(session, activeCase.id, activeCase.caseNumber, reason);
  return { released: true, caseId };
}

async function doReleaseHold(session: AuthenticatedSession, caseId: string, caseNumber: string, reason: string) {
  await prisma.investigationCase.update({
    where: { id: caseId },
    data: { evidenceHoldActive: false, evidenceHoldReleasedAt: new Date(), evidenceHoldReleasedByUserId: session.userId, evidenceHoldReleaseReason: reason },
  });

  const links = await prisma.investigationEvidenceLink.findMany({ where: tenantWhere(session.tenantId, { caseId, enteredInError: false }) });
  for (const link of links) {
    const otherActiveHoldCase = await prisma.investigationEvidenceLink.findFirst({
      where: {
        tenantId: session.tenantId,
        mediaAssetId: link.mediaAssetId,
        enteredInError: false,
        caseId: { not: caseId },
        case: { evidenceHoldActive: true },
      },
    });
    if (!otherActiveHoldCase) {
      await setInvestigationHold(session.tenantId, session.userId, link.mediaAssetId, false, `Investigation hold released for case ${caseNumber}: ${reason}`);
    }
  }

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.holdReleased",
    description: `Evidence hold released: ${reason}`,
    reason,
  });
}
