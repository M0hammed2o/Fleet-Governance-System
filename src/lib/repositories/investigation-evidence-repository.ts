import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordInvestigationEvent } from "@/lib/investigations/investigation-audit";
import { uploadMediaAsset, mintSignedUrlForMediaAsset } from "@/lib/repositories/media-asset-repository";
import { setInvestigationHold } from "@/lib/repositories/retention-repository";
import { InvestigationCaseNotFoundError } from "@/lib/repositories/investigation-case-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { InvestigationConfidentiality } from "@/generated/prisma/client";

export class EvidenceLinkNotFoundError extends Error {
  constructor() {
    super("Investigation evidence item not found.");
    this.name = "EvidenceLinkNotFoundError";
  }
}
export class MediaAssetNotInTenantError extends Error {
  constructor() {
    super("That evidence file was not found in this tenant.");
    this.name = "MediaAssetNotInTenantError";
  }
}
export class EvidenceAlreadyEnteredInErrorError extends Error {
  constructor() {
    super("This evidence item has already been marked entered in error.");
    this.name = "EvidenceAlreadyEnteredInErrorError";
  }
}

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002" &&
    JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target)
  );
}

async function nextEvidenceNumber(tenantId: string, caseId: string): Promise<number> {
  const last = await prisma.investigationEvidenceLink.findFirst({
    where: tenantWhere(tenantId, { caseId }),
    orderBy: { evidenceNumber: "desc" },
  });
  return (last?.evidenceNumber ?? 0) + 1;
}

async function applyHoldIfCaseActive(session: AuthenticatedSession, caseId: string, mediaAssetId: string) {
  const activeCase = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (activeCase?.evidenceHoldActive) {
    await setInvestigationHold(session.tenantId, session.userId, mediaAssetId, true, `Linked as evidence to investigation case ${activeCase.caseNumber}.`);
  }
}

export interface LinkEvidenceInput {
  mediaAssetId: string;
  description: string;
  sourceRecordType?: string | null;
  sourceRecordId?: string | null;
  relevance?: string | null;
  confidentiality?: InvestigationConfidentiality;
}

/** Links an already-existing MediaAsset (e.g. a gate-inspection photo) as case evidence — never duplicates the underlying file (P11F). */
export async function linkEvidenceFromMediaAsset(session: AuthenticatedSession, caseId: string, input: LinkEvidenceInput) {
  await requirePermission(session, "investigationEvidence", "CREATE");
  const activeCase = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!activeCase) throw new InvestigationCaseNotFoundError();

  const asset = await prisma.mediaAsset.findFirst({ where: tenantWhere(session.tenantId, { id: input.mediaAssetId }) });
  if (!asset) throw new MediaAssetNotInTenantError();

  let created;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const evidenceNumber = await nextEvidenceNumber(session.tenantId, caseId);
      created = await prisma.investigationEvidenceLink.create({
        data: {
          tenantId: session.tenantId,
          caseId,
          evidenceNumber,
          mediaAssetId: input.mediaAssetId,
          description: input.description,
          sourceRecordType: input.sourceRecordType ?? null,
          sourceRecordId: input.sourceRecordId ?? null,
          relevance: input.relevance ?? null,
          confidentiality: input.confidentiality ?? "STANDARD",
          addedByUserId: session.userId,
        },
      });
      break;
    } catch (err) {
      if (isUniqueConstraintViolation(err, "evidenceNumber") && attempt < 2) continue;
      throw err;
    }
  }

  await applyHoldIfCaseActive(session, caseId, input.mediaAssetId);

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.evidenceLinked",
    description: `Evidence item #${created!.evidenceNumber} linked: ${input.description}`,
    entityType: "InvestigationEvidenceLink",
    entityId: created!.id,
  });

  return created!;
}

export interface UploadEvidenceInput {
  fileName: string;
  contentType: string;
  data: Buffer;
  idempotencyKey: string;
  description: string;
  relevance?: string | null;
  confidentiality?: InvestigationConfidentiality;
}

/** Uploads a new evidence file directly to the case (as opposed to linking an already-owned record's file) — reuses uploadMediaAsset() exactly (P11F). */
export async function uploadEvidenceToCase(session: AuthenticatedSession, caseId: string, input: UploadEvidenceInput) {
  await requirePermission(session, "investigationEvidence", "CREATE");
  const activeCase = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!activeCase) throw new InvestigationCaseNotFoundError();

  const asset = await uploadMediaAsset({
    tenantId: session.tenantId,
    actorUserId: session.userId,
    ownerType: "INVESTIGATION_CASE",
    ownerId: caseId,
    fileName: input.fileName,
    contentType: input.contentType,
    data: input.data,
    idempotencyKey: input.idempotencyKey,
    category: "INVESTIGATION_EVIDENCE",
  });

  return linkEvidenceFromMediaAsset(session, caseId, {
    mediaAssetId: asset.id,
    description: input.description,
    relevance: input.relevance,
    confidentiality: input.confidentiality,
  });
}

/** Never deletes — an item added in error is marked, with a reason, and stays visible in the manifest (chain-of-custody, P11F). */
export async function markEvidenceEnteredInError(session: AuthenticatedSession, evidenceLinkId: string, reason: string) {
  await requirePermission(session, "investigationEvidence", "CREATE");
  const link = await prisma.investigationEvidenceLink.findFirst({ where: tenantWhere(session.tenantId, { id: evidenceLinkId }) });
  if (!link) throw new EvidenceLinkNotFoundError();
  if (link.enteredInError) throw new EvidenceAlreadyEnteredInErrorError();

  const updated = await prisma.investigationEvidenceLink.update({
    where: { id: evidenceLinkId },
    data: { enteredInError: true, enteredInErrorReason: reason, enteredInErrorByUserId: session.userId, enteredInErrorAt: new Date() },
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId: link.caseId,
    actorUserId: session.userId,
    action: "investigation.evidenceMarkedEnteredInError",
    description: `Evidence item #${link.evidenceNumber} marked entered in error: ${reason}`,
    reason,
    entityType: "InvestigationEvidenceLink",
    entityId: evidenceLinkId,
  });

  return updated;
}

export async function listEvidenceForCase(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationEvidence", "VIEW");
  return prisma.investigationEvidenceLink.findMany({
    where: tenantWhere(session.tenantId, { caseId }),
    include: { addedBy: { select: { id: true, name: true } }, mediaAsset: { select: { id: true, fileName: true, contentType: true, fileSizeBytes: true, checksumSha256: true, category: true } } },
    orderBy: { evidenceNumber: "asc" },
  });
}

/** Mints a short-lived signed download URL, same mechanism as every other MediaAsset download (P11F) — never a public URL. */
export async function getEvidenceDownloadUrl(session: AuthenticatedSession, evidenceLinkId: string) {
  await requirePermission(session, "investigationEvidence", "EXPORT");
  const link = await prisma.investigationEvidenceLink.findFirst({ where: tenantWhere(session.tenantId, { id: evidenceLinkId }) });
  if (!link) throw new EvidenceLinkNotFoundError();
  return mintSignedUrlForMediaAsset(session.tenantId, session.userId, link.mediaAssetId);
}
