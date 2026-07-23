import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";

export class SelfApprovalNotAllowedError extends Error {
  constructor() {
    super("A user cannot resolve their own manual facial-verification fallback request.");
    this.name = "SelfApprovalNotAllowedError";
  }
}

export class EvidenceMediaAssetNotFoundError extends Error {
  constructor() {
    super("The referenced evidence media asset was not found for this fallback request.");
    this.name = "EvidenceMediaAssetNotFoundError";
  }
}

export interface RequestManualFallbackInput {
  tenantId: string;
  driverId: string;
  requestedByUserId: string;
  reason: string;
}

/** Gate officer requests manual verification when the (mock) provider can't confirm identity automatically. */
export async function requestManualFallback(input: RequestManualFallbackInput) {
  const fallback = await prisma.manualFacialVerificationFallback.create({
    data: {
      tenantId: input.tenantId,
      driverId: input.driverId,
      requestedByUserId: input.requestedByUserId,
      reason: input.reason,
      status: "PENDING",
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.requestedByUserId,
    action: "facialVerification.manualFallback.requested",
    entityType: "ManualFacialVerificationFallback",
    entityId: fallback.id,
    reason: input.reason,
  });

  return fallback;
}

/**
 * Attaches previously uploaded evidence (a MediaAsset created via
 * POST /api/media/upload with ownerType=MANUAL_FACIAL_VERIFICATION_FALLBACK,
 * ownerId=this fallback's id) to an existing fallback request — a separate
 * step from requestManualFallback() because the MediaAsset's owning-record
 * check needs the fallback to already exist (Phase 4, see DECISIONS.md D-012).
 */
export async function attachEvidenceToManualFallback(
  tenantId: string,
  fallbackId: string,
  actorUserId: string,
  evidenceMediaAssetId: string,
) {
  const fallback = await prisma.manualFacialVerificationFallback.findFirst({
    where: tenantWhere(tenantId, { id: fallbackId }),
  });
  if (!fallback) return null;

  const evidence = await prisma.mediaAsset.findFirst({
    where: tenantWhere(tenantId, {
      id: evidenceMediaAssetId,
      ownerType: "MANUAL_FACIAL_VERIFICATION_FALLBACK" as const,
      ownerId: fallbackId,
    }),
  });
  if (!evidence) throw new EvidenceMediaAssetNotFoundError();

  const updated = await prisma.manualFacialVerificationFallback.update({
    where: { id: fallbackId },
    data: { evidenceMediaAssetId },
  });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "facialVerification.manualFallback.evidenceAttached",
    entityType: "ManualFacialVerificationFallback",
    entityId: fallbackId,
    afterValue: { evidenceMediaAssetId },
  });

  return updated;
}

export interface ResolveManualFallbackInput {
  tenantId: string;
  fallbackId: string;
  approvedByUserId: string;
  decision: "APPROVED" | "DENIED";
}

/**
 * A supervisor resolves a pending request. Enforces that the resolver isn't
 * the same person who requested it — same self-approval principle as
 * MovementAuthorisation, applied here even though the build brief doesn't
 * make this one tenant-configurable (identity verification integrity is not
 * something to make optional).
 */
export async function resolveManualFallback(input: ResolveManualFallbackInput) {
  const fallback = await prisma.manualFacialVerificationFallback.findFirst({
    where: tenantWhere(input.tenantId, { id: input.fallbackId }),
  });
  if (!fallback) return null;
  if (fallback.requestedByUserId === input.approvedByUserId) {
    throw new SelfApprovalNotAllowedError();
  }
  if (fallback.status !== "PENDING") {
    return fallback;
  }

  const updated = await prisma.manualFacialVerificationFallback.update({
    where: { id: fallback.id },
    data: { status: input.decision, approvedByUserId: input.approvedByUserId, resolvedAt: new Date() },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.approvedByUserId,
    action: `facialVerification.manualFallback.${input.decision === "APPROVED" ? "approved" : "denied"}`,
    entityType: "ManualFacialVerificationFallback",
    entityId: fallback.id,
    beforeValue: { status: "PENDING" },
    afterValue: { status: input.decision },
  });

  return updated;
}

export async function listManualFallbacksForDriver(tenantId: string, driverId: string) {
  return prisma.manualFacialVerificationFallback.findMany({
    where: tenantWhere(tenantId, { driverId }),
    orderBy: { requestedAt: "desc" },
  });
}
