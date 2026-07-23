import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { ComplianceDocumentType } from "@/generated/prisma/client";

export class InvalidDocumentOwnerError extends Error {
  constructor() {
    super("A compliance document must belong to exactly one driver or vehicle.");
    this.name = "InvalidDocumentOwnerError";
  }
}

export class EvidenceMediaAssetNotFoundError extends Error {
  constructor() {
    super("The referenced attachment media asset was not found for this document.");
    this.name = "EvidenceMediaAssetNotFoundError";
  }
}

export interface CreateComplianceDocumentInput {
  tenantId: string;
  ownerType: "DRIVER" | "VEHICLE";
  driverId?: string | null;
  vehicleId?: string | null;
  documentType: ComplianceDocumentType;
  documentNumber?: string | null;
  issueDate?: Date | null;
  expiryDate?: Date | null;
  issuer?: string | null;
  notes?: string | null;
}

export async function createComplianceDocument(input: CreateComplianceDocumentInput) {
  const hasDriver = Boolean(input.driverId);
  const hasVehicle = Boolean(input.vehicleId);
  if (hasDriver === hasVehicle) {
    // Exactly one must be set — both or neither is invalid.
    throw new InvalidDocumentOwnerError();
  }
  if ((input.ownerType === "DRIVER") !== hasDriver) {
    throw new InvalidDocumentOwnerError();
  }

  return prisma.complianceDocument.create({
    data: {
      tenantId: input.tenantId,
      ownerType: input.ownerType,
      driverId: input.driverId ?? null,
      vehicleId: input.vehicleId ?? null,
      documentType: input.documentType,
      documentNumber: input.documentNumber ?? null,
      issueDate: input.issueDate ?? null,
      expiryDate: input.expiryDate ?? null,
      issuer: input.issuer ?? null,
      notes: input.notes ?? null,
    },
  });
}

/**
 * Attaches a previously uploaded MediaAsset (POST /api/media/upload,
 * ownerType=COMPLIANCE_DOCUMENT, ownerId=this document's id) — a separate
 * step from createComplianceDocument() since the MediaAsset's owner-existence
 * check needs the document id to already exist. See DECISIONS.md D-012.
 */
export async function attachAttachmentToComplianceDocument(
  tenantId: string,
  documentId: string,
  attachmentMediaAssetId: string,
) {
  const document = await prisma.complianceDocument.findFirst({ where: tenantWhere(tenantId, { id: documentId }) });
  if (!document) return null;

  const evidence = await prisma.mediaAsset.findFirst({
    where: tenantWhere(tenantId, {
      id: attachmentMediaAssetId,
      ownerType: "COMPLIANCE_DOCUMENT" as const,
      ownerId: documentId,
    }),
  });
  if (!evidence) throw new EvidenceMediaAssetNotFoundError();

  return prisma.complianceDocument.update({
    where: { id: documentId },
    data: { attachmentMediaAssetId },
  });
}

export async function getComplianceDocumentInTenant(tenantId: string, documentId: string) {
  return prisma.complianceDocument.findFirst({ where: tenantWhere(tenantId, { id: documentId }) });
}

export async function verifyComplianceDocument(
  tenantId: string,
  documentId: string,
  verifiedById: string,
  decision: "VERIFIED" | "REJECTED",
) {
  const result = await prisma.complianceDocument.updateMany({
    where: tenantWhere(tenantId, { id: documentId }),
    data: { verificationStatus: decision, verifiedById, verifiedAt: new Date() },
  });
  return result.count > 0;
}

export async function archiveComplianceDocument(tenantId: string, documentId: string) {
  const result = await prisma.complianceDocument.updateMany({
    where: tenantWhere(tenantId, { id: documentId }),
    data: { archivedAt: new Date() },
  });
  return result.count > 0;
}
