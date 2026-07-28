import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { getDefaultObjectStorageProvider } from "@/lib/repositories/media-asset-repository";
import { getEffectiveRetentionPolicy } from "@/lib/repositories/retention-policy-repository";
import {
  evaluateDeletionEligibility,
  currentRetentionMilestone,
  computeScheduledDeletionAt,
  type RetentionNotificationMilestone,
} from "@/lib/retention/deletion-rules";
import { getArchiveTierForBytes } from "@/lib/retention/archive-pricing";
import { NoOpStorageBillingHookProvider, type StorageBillingHookProvider } from "@/lib/retention/storage-billing-hook";
import type { MediaCategory, MediaAsset, Prisma } from "@/generated/prisma/client";

const defaultProvider = getDefaultObjectStorageProvider();
const defaultBillingHook: StorageBillingHookProvider = new NoOpStorageBillingHookProvider();

// Approved evidence enters this recovery window before permanent deletion —
// configurable per request (ARCHITECTURE.md "Deletion rules").
export const DEFAULT_RECOVERY_DAYS = 30;

export class MediaAssetNotEligibleForDeletionError extends Error {
  constructor(reasons: string[]) {
    super(`This evidence cannot be deleted: ${reasons.join(" ")}`);
    this.name = "MediaAssetNotEligibleForDeletionError";
  }
}
export class DeletionRequestNotFoundError extends Error {
  constructor() {
    super("Deletion request not found.");
    this.name = "DeletionRequestNotFoundError";
  }
}
export class DeletionRequestNotPendingError extends Error {
  constructor() {
    super("This deletion request has already been decided.");
    this.name = "DeletionRequestNotPendingError";
  }
}
export class SelfApprovalNotAllowedError extends Error {
  constructor() {
    super("The user who initiated a deletion request cannot approve or reject it themselves.");
    this.name = "SelfApprovalNotAllowedError";
  }
}
export class NotRequestInitiatorError extends Error {
  constructor() {
    super("Only the user who initiated this deletion request can cancel it.");
    this.name = "NotRequestInitiatorError";
  }
}
export class DeletionRequestNotApprovedError extends Error {
  constructor() {
    super("This deletion request has not been approved yet.");
    this.name = "DeletionRequestNotApprovedError";
  }
}
export class RecoveryPeriodNotElapsedError extends Error {
  constructor() {
    super("This deletion request's recovery period has not elapsed yet.");
    this.name = "RecoveryPeriodNotElapsedError";
  }
}
export class EmptyDeletionScopeError extends Error {
  constructor() {
    super("No evidence matched the given category/date-range scope, or every match is currently ineligible (hold/unresolved exception).");
    this.name = "EmptyDeletionScopeError";
  }
}
export class ExportRequestNotFoundError extends Error {
  constructor() {
    super("Export request not found.");
    this.name = "ExportRequestNotFoundError";
  }
}
export class MediaAssetNotFoundError extends Error {
  constructor() {
    super("Media asset not found.");
    this.name = "MediaAssetNotFoundError";
  }
}

/** Best-effort, documented-scope check — see lib/retention/deletion-rules.ts's module docstring for what this codebase can and can't evaluate. */
async function hasUnresolvedLinkedException(tenantId: string, asset: Pick<MediaAsset, "ownerType" | "ownerId">): Promise<boolean> {
  const gateEventId = asset.ownerType === "GATE_EVENT" || asset.ownerType === "GATE_EVENT_INSPECTION_ITEM" ? asset.ownerId : null;
  if (!gateEventId) return false;
  const count = await prisma.exception.count({ where: { tenantId, gateEventId, resolvedAt: null } });
  return count > 0;
}

async function checkEligibility(tenantId: string, asset: MediaAsset) {
  const hasException = await hasUnresolvedLinkedException(tenantId, asset);
  return evaluateDeletionEligibility({
    legalHold: asset.legalHold,
    investigationHold: asset.investigationHold,
    hasUnresolvedLinkedException: hasException,
  });
}

// --- Evidence browsing (8E-005 retention management UI) --------------------

export interface EvidenceListItem {
  id: string;
  category: MediaCategory;
  fileName: string;
  fileSizeBytes: number;
  capturedAt: Date;
  retentionStatus: string;
  scheduledDeletionAt: Date | null;
  legalHold: boolean;
  investigationHold: boolean;
  retentionExtendedAt: Date | null;
}

export interface ListEvidenceFilter {
  category?: MediaCategory;
  onlyHeld?: boolean;
  onlyApproachingExpiry?: boolean;
}

/**
 * Evidence metadata only — never storageKey/checksumSha256/thumbnailStorageKey,
 * so browsing this list can never itself be used to fetch a raw file; a
 * signed URL still requires a separate mintSignedUrlForMediaAsset() call
 * with its own audit-on-read (EVID-002). This is the "select evidence to
 * hold/extend/archive" browsing surface for the retention management UI,
 * gated the same as everything else here (`retention:VIEW`).
 */
export async function listEvidenceInTenant(tenantId: string, filter: ListEvidenceFilter = {}, now: Date = new Date()): Promise<EvidenceListItem[]> {
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const where: Prisma.MediaAssetWhereInput = {
    tenantId,
    uploadStatus: "READY",
    binaryDeletedAt: null,
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.onlyHeld ? { OR: [{ legalHold: true }, { investigationHold: true }] } : {}),
    ...(filter.onlyApproachingExpiry
      ? { retentionStatus: "ACTIVE" as const, scheduledDeletionAt: { not: null, gte: now, lte: ninetyDaysFromNow } }
      : {}),
  };

  const assets = await prisma.mediaAsset.findMany({ where, orderBy: { capturedAt: "desc" }, take: 200 });
  return assets.map((a) => ({
    id: a.id,
    category: a.category,
    fileName: a.fileName,
    fileSizeBytes: a.fileSizeBytes,
    capturedAt: a.capturedAt,
    retentionStatus: a.retentionStatus,
    scheduledDeletionAt: a.scheduledDeletionAt,
    legalHold: a.legalHold,
    investigationHold: a.investigationHold,
    retentionExtendedAt: a.retentionExtendedAt,
  }));
}

// --- Holds -------------------------------------------------------------------

export async function setLegalHold(tenantId: string, actorUserId: string, mediaAssetId: string, hold: boolean, reason: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: tenantWhere(tenantId, { id: mediaAssetId }) });
  if (!asset) throw new MediaAssetNotFoundError();

  const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { legalHold: hold } });
  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: hold ? "retention.legalHoldApplied" : "retention.legalHoldReleased",
    entityType: "MediaAsset",
    entityId: asset.id,
    reason,
    beforeValue: { legalHold: asset.legalHold },
    afterValue: { legalHold: hold },
  });
  return updated;
}

export async function setInvestigationHold(tenantId: string, actorUserId: string, mediaAssetId: string, hold: boolean, reason: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: tenantWhere(tenantId, { id: mediaAssetId }) });
  if (!asset) throw new MediaAssetNotFoundError();

  const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { investigationHold: hold } });
  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: hold ? "retention.investigationHoldApplied" : "retention.investigationHoldReleased",
    entityType: "MediaAsset",
    entityId: asset.id,
    reason,
    beforeValue: { investigationHold: asset.investigationHold },
    afterValue: { investigationHold: hold },
  });
  return updated;
}

// --- Retention extension and archive -----------------------------------------

export async function extendRetention(tenantId: string, actorUserId: string, mediaAssetId: string, newScheduledDeletionAt: Date, reason: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: tenantWhere(tenantId, { id: mediaAssetId }) });
  if (!asset) throw new MediaAssetNotFoundError();

  // retentionExtendedAt marks this as a deliberate human override (8E-001)
  // — automatic assignment/backfill must never recalculate over it.
  const updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { scheduledDeletionAt: newScheduledDeletionAt, retentionExtendedAt: new Date() },
  });
  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "retention.extended",
    entityType: "MediaAsset",
    entityId: asset.id,
    reason,
    beforeValue: { scheduledDeletionAt: asset.scheduledDeletionAt },
    afterValue: { scheduledDeletionAt: newScheduledDeletionAt },
  });
  return updated;
}

/** "Retain in paid archive storage" — one of the four customer retention choices. Reports usage through the (no-op, unconfigured) billing hook. */
export async function moveAssetsToArchive(tenantId: string, actorUserId: string, mediaAssetIds: string[], billingHook: StorageBillingHookProvider = defaultBillingHook) {
  const assets = await prisma.mediaAsset.findMany({ where: tenantWhere(tenantId, { id: { in: mediaAssetIds } } satisfies Prisma.MediaAssetWhereInput) });
  const ineligibleCategories = new Set<MediaCategory>();
  for (const asset of assets) {
    const policy = await getEffectiveRetentionPolicy(tenantId, asset.category);
    if (!policy.archiveEligible) ineligibleCategories.add(asset.category);
  }
  const archivable = assets.filter((a) => !ineligibleCategories.has(a.category));

  await prisma.mediaAsset.updateMany({ where: { id: { in: archivable.map((a) => a.id) } }, data: { retentionStatus: "ARCHIVED" } });

  const totalBytes = archivable.reduce((sum, a) => sum + a.fileSizeBytes, 0);
  const tier = getArchiveTierForBytes(totalBytes);
  const now = new Date();
  await billingHook.reportUsage({ tenantId, billingPeriodStart: now, billingPeriodEnd: now, archivedBytes: totalBytes, tier });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "retention.movedToArchive",
    entityType: "MediaAsset",
    entityId: "BULK",
    afterValue: { assetCount: archivable.length, totalBytes, tier: tier.label },
  });

  return { archivedCount: archivable.length, skippedCount: assets.length - archivable.length, totalBytes };
}

// --- Automatic retention assignment / backfill (8E-001) ---------------------

export interface BackfillScheduledDeletionResult {
  scannedCount: number;
  assignedCount: number;
}

/**
 * Idempotent, callable backfill for pre-existing ACTIVE MediaAsset rows
 * whose scheduledDeletionAt is still null (uploaded before automatic
 * assignment existed in uploadMediaAsset()/confirmPresignedUpload() — see
 * media-asset-repository.ts). The one-time production backfill for rows
 * that existed before this phase shipped runs as SQL inside migration
 * `20260727090000_phase8e_retention_extension_and_backfill`; this function
 * is the same logic exposed as an ordinary, testable, safely re-runnable
 * repository call (e.g. for a future scheduler job or an on-demand admin
 * action) — running it twice is a no-op the second time, since it only ever
 * targets rows where scheduledDeletionAt IS NULL.
 *
 * Deliberately excludes (per 8E-001's explicit scope):
 *   - retentionStatus other than ACTIVE (already-archived, pending-deletion,
 *     or permanently-deleted metadata records)
 *   - legalHold / investigationHold (policy requires restriction)
 *   - retentionExtendedAt set (a human already made an explicit decision)
 */
export async function backfillMissingScheduledDeletionAt(tenantId?: string): Promise<BackfillScheduledDeletionResult> {
  const candidates = await prisma.mediaAsset.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      retentionStatus: "ACTIVE",
      scheduledDeletionAt: null,
      legalHold: false,
      investigationHold: false,
      retentionExtendedAt: null,
    },
  });

  let assignedCount = 0;
  for (const asset of candidates) {
    const policy = await getEffectiveRetentionPolicy(asset.tenantId, asset.category);
    const scheduledDeletionAt = computeScheduledDeletionAt(asset.capturedAt, policy.retentionDays);
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { scheduledDeletionAt } });
    assignedCount++;
  }

  return { scannedCount: candidates.length, assignedCount };
}

// --- Deletion request workflow (dual-control, 30-day recovery) --------------

export interface DeletionScope {
  categories: MediaCategory[];
  dateRangeStart?: Date | null;
  dateRangeEnd?: Date | null;
}

function scopeWhere(tenantId: string, scope: DeletionScope): Prisma.MediaAssetWhereInput {
  return {
    tenantId,
    category: { in: scope.categories },
    uploadStatus: "READY",
    retentionStatus: { not: "DELETED" },
    binaryDeletedAt: null,
    ...(scope.dateRangeStart || scope.dateRangeEnd
      ? { capturedAt: { ...(scope.dateRangeStart ? { gte: scope.dateRangeStart } : {}), ...(scope.dateRangeEnd ? { lte: scope.dateRangeEnd } : {}) } }
      : {}),
  };
}

export interface CreateDeletionRequestInput {
  tenantId: string;
  actorUserId: string;
  scope: DeletionScope;
  recoveryDays?: number;
}

/**
 * Company Administrator initiates deletion (ARCHITECTURE.md "Deletion
 * rules"). Snapshots every currently-matching, currently-eligible asset
 * into the request at creation time — an asset under legal/investigation
 * hold or linked to an unresolved exception is simply excluded from the
 * batch (not a reason to fail the whole request), reported back as
 * `excludedCount` for transparency.
 */
export async function createDeletionRequest(input: CreateDeletionRequestInput) {
  const candidates = await prisma.mediaAsset.findMany({ where: scopeWhere(input.tenantId, input.scope) });

  const eligible: MediaAsset[] = [];
  for (const asset of candidates) {
    const eligibility = await checkEligibility(input.tenantId, asset);
    if (eligibility.allowed) eligible.push(asset);
  }
  if (eligible.length === 0) throw new EmptyDeletionScopeError();

  const totalBytes = eligible.reduce((sum, a) => sum + a.fileSizeBytes, 0);

  // P11-000 (DECISIONS.md D-038): asset links are created via a separate,
  // explicit createMany() rather than a nested `assets: { create: [...] }`
  // write — see the same pattern's rationale in invoice-repository.ts.
  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.deletionRequest.create({
      data: {
        tenantId: input.tenantId,
        categories: input.scope.categories,
        dateRangeStart: input.scope.dateRangeStart ?? null,
        dateRangeEnd: input.scope.dateRangeEnd ?? null,
        initiatedByUserId: input.actorUserId,
        recoveryDays: input.recoveryDays ?? DEFAULT_RECOVERY_DAYS,
        assetCount: eligible.length,
        totalBytes,
      },
    });
    await tx.deletionRequestAsset.createMany({
      data: eligible.map((a) => ({ deletionRequestId: created.id, mediaAssetId: a.id })),
    });
    return created;
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "retention.deletionRequested",
    entityType: "DeletionRequest",
    entityId: request.id,
    afterValue: { categories: input.scope.categories, assetCount: eligible.length, totalBytes, excludedCount: candidates.length - eligible.length },
  });

  return { deletionRequest: request, excludedCount: candidates.length - eligible.length };
}

/** Hard rule: the approver can never be the same user who initiated the request — same "raiser cannot be resolver" family as D-008/D-020, unconditional. */
export async function approveDeletionRequest(tenantId: string, actorUserId: string, deletionRequestId: string) {
  const request = await prisma.deletionRequest.findFirst({ where: tenantWhere(tenantId, { id: deletionRequestId }) });
  if (!request) throw new DeletionRequestNotFoundError();
  if (request.status !== "PENDING_APPROVAL") throw new DeletionRequestNotPendingError();
  if (request.initiatedByUserId === actorUserId) throw new SelfApprovalNotAllowedError();

  // Defense in depth: re-check eligibility for every linked asset at
  // approval time too — a hold may have been applied since initiation.
  const links = await prisma.deletionRequestAsset.findMany({ where: { deletionRequestId }, include: { mediaAsset: true } });
  const stillEligibleIds: string[] = [];
  for (const link of links) {
    const eligibility = await checkEligibility(tenantId, link.mediaAsset);
    if (eligibility.allowed) stillEligibleIds.push(link.mediaAssetId);
  }
  if (stillEligibleIds.length === 0) throw new EmptyDeletionScopeError();

  const recoveryExpiresAt = new Date(Date.now() + request.recoveryDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.deletionRequest.update({
    where: { id: request.id },
    data: { status: "APPROVED", approvedByUserId: actorUserId, approvedAt: new Date(), recoveryExpiresAt },
  });
  await prisma.mediaAsset.updateMany({ where: { id: { in: stillEligibleIds } }, data: { retentionStatus: "PENDING_DELETION" } });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "retention.deletionApproved",
    entityType: "DeletionRequest",
    entityId: request.id,
    afterValue: { recoveryExpiresAt, eligibleAssetCount: stillEligibleIds.length },
  });

  return updated;
}

export async function rejectDeletionRequest(tenantId: string, actorUserId: string, deletionRequestId: string, reason: string) {
  const request = await prisma.deletionRequest.findFirst({ where: tenantWhere(tenantId, { id: deletionRequestId }) });
  if (!request) throw new DeletionRequestNotFoundError();
  if (request.status !== "PENDING_APPROVAL") throw new DeletionRequestNotPendingError();
  if (request.initiatedByUserId === actorUserId) throw new SelfApprovalNotAllowedError();

  const updated = await prisma.deletionRequest.update({
    where: { id: request.id },
    data: { status: "REJECTED", rejectedByUserId: actorUserId, rejectedAt: new Date(), rejectionReason: reason },
  });

  await recordAudit({ tenantId, userId: actorUserId, action: "retention.deletionRejected", entityType: "DeletionRequest", entityId: request.id, reason });
  return updated;
}

export async function cancelDeletionRequest(tenantId: string, actorUserId: string, deletionRequestId: string) {
  const request = await prisma.deletionRequest.findFirst({ where: tenantWhere(tenantId, { id: deletionRequestId }) });
  if (!request) throw new DeletionRequestNotFoundError();
  if (request.status !== "PENDING_APPROVAL") throw new DeletionRequestNotPendingError();
  if (request.initiatedByUserId !== actorUserId) throw new NotRequestInitiatorError();

  const updated = await prisma.deletionRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
  await recordAudit({ tenantId, userId: actorUserId, action: "retention.deletionCancelled", entityType: "DeletionRequest", entityId: request.id });
  return updated;
}

/**
 * Permanently deletes every still-eligible asset in an APPROVED request
 * whose recovery period has elapsed, and issues an immutable
 * DeletionCertificate. Not yet wired to any scheduler (no scheduling
 * infrastructure exists in this codebase — same documented gap as the
 * existing `expireMovement` auto-transition, see TODO.md); callable
 * on-demand via `POST /api/admin/retention/deletion-requests/process-due`.
 * A second, final eligibility re-check runs here too — an asset that
 * gained a hold during the recovery window is skipped, not deleted.
 */
export async function completeDeletionRequest(tenantId: string, deletionRequestId: string, now: Date = new Date()) {
  const request = await prisma.deletionRequest.findFirst({ where: tenantWhere(tenantId, { id: deletionRequestId }) });
  if (!request) throw new DeletionRequestNotFoundError();
  if (request.status !== "APPROVED") throw new DeletionRequestNotApprovedError();
  if (!request.recoveryExpiresAt || request.recoveryExpiresAt > now) throw new RecoveryPeriodNotElapsedError();

  const links = await prisma.deletionRequestAsset.findMany({ where: { deletionRequestId }, include: { mediaAsset: true } });
  const manifest: Array<{ mediaAssetId: string; fileName: string; checksumSha256: string }> = [];
  let deletedBytes = 0;

  for (const link of links) {
    const asset = link.mediaAsset;
    if (asset.binaryDeletedAt) continue; // already gone (idempotent re-run safety)
    const eligibility = await checkEligibility(tenantId, asset);
    if (!eligibility.allowed) continue; // gained a hold during the recovery window — skip, don't delete

    await defaultProvider.delete(asset.storageKey).catch(() => {});
    if (asset.thumbnailStorageKey) await defaultProvider.delete(asset.thumbnailStorageKey).catch(() => {});
    if (asset.originalStorageKey) await defaultProvider.delete(asset.originalStorageKey).catch(() => {});

    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { binaryDeletedAt: now, retentionStatus: "DELETED" } });
    manifest.push({ mediaAssetId: asset.id, fileName: asset.fileName, checksumSha256: asset.checksumSha256 });
    deletedBytes += asset.fileSizeBytes;
  }

  const certificate = await prisma.deletionCertificate.create({
    data: {
      tenantId,
      deletionRequestId: request.id,
      categories: request.categories,
      dateRangeStart: request.dateRangeStart,
      dateRangeEnd: request.dateRangeEnd,
      assetCount: manifest.length,
      totalBytes: deletedBytes,
      initiatedByUserId: request.initiatedByUserId,
      approvedByUserId: request.approvedByUserId!,
      checksumManifest: manifest,
    },
  });

  await prisma.deletionRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: now } });

  await recordAudit({
    tenantId,
    userId: request.approvedByUserId,
    action: "retention.deletionCompleted",
    entityType: "DeletionRequest",
    entityId: request.id,
    afterValue: { certificateId: certificate.id, deletedCount: manifest.length, skippedCount: links.length - manifest.length },
  });

  return certificate;
}

/** Finds every APPROVED request whose recovery window has elapsed and completes it — the batch entry point for a future scheduler. */
export async function completeDueDeletionRequests(now: Date = new Date()) {
  const due = await prisma.deletionRequest.findMany({ where: { status: "APPROVED", recoveryExpiresAt: { lte: now } } });
  const certificates = [];
  for (const request of due) {
    certificates.push(await completeDeletionRequest(request.tenantId, request.id, now));
  }
  return certificates;
}

export async function listDeletionRequestsInTenant(tenantId: string) {
  return prisma.deletionRequest.findMany({ where: tenantWhere(tenantId), orderBy: { initiatedAt: "desc" }, include: { certificate: true } });
}

export async function getDeletionRequestInTenant(tenantId: string, deletionRequestId: string) {
  return prisma.deletionRequest.findFirst({ where: tenantWhere(tenantId, { id: deletionRequestId }), include: { certificate: true, assets: { include: { mediaAsset: true } } } });
}

// --- Export request workflow --------------------------------------------------

const EXPORT_SIGNED_URL_EXPIRY_SECONDS = 24 * 60 * 60; // 24h — long enough to actually download a batch, unlike the 5-minute inline-view default

export interface CreateExportRequestInput {
  tenantId: string;
  actorUserId: string;
  scope: DeletionScope;
}

/**
 * "Export and then delete" (one of the four customer retention choices).
 * Deliberately a signed manifest of downloadable evidence (metadata + a
 * per-file expiring signed URL), not a server-generated zip archive — see
 * DATA_MODEL.md's ExportRequest note for why. Synchronous/immediate (READY
 * on return) since building the manifest only mints existing signed-URL
 * infrastructure, no heavy async job needed.
 */
export async function createExportRequest(input: CreateExportRequestInput) {
  const assets = await prisma.mediaAsset.findMany({ where: scopeWhere(input.tenantId, input.scope) });

  const expiresAt = new Date(Date.now() + EXPORT_SIGNED_URL_EXPIRY_SECONDS * 1000);
  const manifest = await Promise.all(
    assets.map(async (asset) => ({
      mediaAssetId: asset.id,
      fileName: asset.fileName,
      category: asset.category,
      checksumSha256: asset.checksumSha256,
      fileSizeBytes: asset.fileSizeBytes,
      signedUrl: await defaultProvider.getSignedReadUrl(asset.storageKey, EXPORT_SIGNED_URL_EXPIRY_SECONDS),
    })),
  );

  const totalBytes = assets.reduce((sum, a) => sum + a.fileSizeBytes, 0);

  const request = await prisma.exportRequest.create({
    data: {
      tenantId: input.tenantId,
      categories: input.scope.categories,
      dateRangeStart: input.scope.dateRangeStart ?? null,
      dateRangeEnd: input.scope.dateRangeEnd ?? null,
      requestedByUserId: input.actorUserId,
      status: "READY",
      manifest: { assets: manifest, generatedAt: new Date().toISOString() },
      expiresAt,
      assetCount: assets.length,
      totalBytes,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "retention.exportReady",
    entityType: "ExportRequest",
    entityId: request.id,
    afterValue: { categories: input.scope.categories, assetCount: assets.length, totalBytes },
  });

  return request;
}

export async function getExportRequestInTenant(tenantId: string, exportRequestId: string) {
  const request = await prisma.exportRequest.findFirst({ where: tenantWhere(tenantId, { id: exportRequestId }) });
  if (!request) throw new ExportRequestNotFoundError();
  return request;
}

export async function listExportRequestsInTenant(tenantId: string) {
  return prisma.exportRequest.findMany({ where: tenantWhere(tenantId), orderBy: { requestedAt: "desc" } });
}

/**
 * Background job (8E-004): marks every PENDING/READY ExportRequest whose
 * `expiresAt` has passed as EXPIRED — the signed download URLs inside its
 * manifest are already unusable by then (SIGNED_URL/EXPORT expiry is
 * enforced independently by the storage provider itself), this just keeps
 * the request's own status honest for anyone listing export requests.
 * Idempotent: only ever touches rows not already EXPIRED, so re-running
 * finds nothing left to do the second time.
 */
export async function expireOldExportRequests(now: Date = new Date(), tenantId?: string): Promise<{ expiredCount: number }> {
  const result = await prisma.exportRequest.updateMany({
    where: { ...(tenantId ? { tenantId } : {}), status: { in: ["PENDING", "READY"] }, expiresAt: { not: null, lt: now } },
    data: { status: "EXPIRED" },
  });
  return { expiredCount: result.count };
}

/**
 * Background job (8E-004): reports current archived-storage usage for
 * every tenant through the (no-op by default) StorageBillingHookProvider —
 * the periodic counterpart to the per-action report already fired inside
 * moveAssetsToArchive(). A tenant with nothing archived is skipped
 * entirely (never reports a phantom R0 line item) rather than calling the
 * hook with zero bytes.
 */
export async function reportArchiveUsageForAllTenants(
  billingHook: StorageBillingHookProvider = defaultBillingHook,
  now: Date = new Date(),
  tenantId?: string,
): Promise<{ tenantsReported: number }> {
  const byTenant = await prisma.mediaAsset.groupBy({
    by: ["tenantId"],
    where: { ...(tenantId ? { tenantId } : {}), retentionStatus: "ARCHIVED" },
    _sum: { fileSizeBytes: true },
  });

  let tenantsReported = 0;
  for (const row of byTenant) {
    const totalBytes = row._sum.fileSizeBytes ?? 0;
    if (totalBytes <= 0) continue;
    const tier = getArchiveTierForBytes(totalBytes);
    await billingHook.reportUsage({ tenantId: row.tenantId, billingPeriodStart: now, billingPeriodEnd: now, archivedBytes: totalBytes, tier });
    tenantsReported++;
  }

  return { tenantsReported };
}

// --- Retention-expiry notifications (computed, not delivered — see lib/retention/deletion-rules.ts) ---

export interface DueRetentionNotification {
  mediaAssetId: string;
  category: MediaCategory;
  scheduledDeletionAt: Date;
  milestone: RetentionNotificationMilestone;
}

/**
 * Which 90/60/30/7/expiry-day notifications currently apply, computed live
 * — no email/SMS is actually sent (no notification provider exists,
 * INTEGRATIONS.md), so this is "prepared for" each milestone per Phase 8C's
 * requirement, not a delivered notification.
 */
export async function getDueRetentionNotifications(tenantId: string, now: Date = new Date()): Promise<DueRetentionNotification[]> {
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const assets = await prisma.mediaAsset.findMany({
    where: {
      tenantId,
      retentionStatus: "ACTIVE",
      scheduledDeletionAt: { not: null, gte: now, lte: ninetyDaysFromNow },
    },
    select: { id: true, category: true, scheduledDeletionAt: true },
  });

  const due: DueRetentionNotification[] = [];
  for (const asset of assets) {
    const milestone = currentRetentionMilestone(asset.scheduledDeletionAt!, now);
    if (milestone !== null) due.push({ mediaAssetId: asset.id, category: asset.category, scheduledDeletionAt: asset.scheduledDeletionAt!, milestone });
  }
  return due;
}
