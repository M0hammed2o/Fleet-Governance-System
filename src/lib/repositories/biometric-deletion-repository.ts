import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import type {
  DeletionRequestStatus,
  DriverFacialTemplateStatus,
} from "@/generated/prisma/client";

export class BiometricDeletionNotFoundError extends Error {
  constructor() {
    super("Biometric deletion request not found.");
    this.name = "BiometricDeletionNotFoundError";
  }
}
export class BiometricDeletionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiometricDeletionStateError";
  }
}
export class BiometricDeletionSelfApprovalError extends Error {
  constructor() {
    super("The user who requested biometric deletion cannot approve it.");
    this.name = "BiometricDeletionSelfApprovalError";
  }
}

export async function requestBiometricTemplateDeletion(input: {
  tenantId: string;
  driverId: string;
  actorUserId: string;
  reason: string;
}) {
  const template = await prisma.driverFacialTemplate.findFirst({
    where: tenantWhere(input.tenantId, {
      driverId: input.driverId,
      status: { in: ["ACTIVE", "REVOKED", "EXPIRED"] as DriverFacialTemplateStatus[] },
    }),
    orderBy: { version: "desc" },
  });
  if (!template) throw new BiometricDeletionNotFoundError();

  const existing = await prisma.biometricTemplateDeletionRequest.findFirst({
    where: tenantWhere(input.tenantId, {
      templateId: template.id,
      status: { in: ["PENDING_APPROVAL", "APPROVED", "IN_RECOVERY"] as DeletionRequestStatus[] },
    }),
  });
  if (existing) return existing;

  const request = await prisma.biometricTemplateDeletionRequest.create({
    data: {
      tenantId: input.tenantId,
      driverId: input.driverId,
      templateId: template.id,
      reason: input.reason,
      initiatedByUserId: input.actorUserId,
    },
  });
  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "facialTemplate.deletionRequested",
    entityType: "BiometricTemplateDeletionRequest",
    entityId: request.id,
    reason: input.reason,
    afterValue: { driverId: input.driverId, templateVersion: template.version },
  });
  return request;
}

export async function approveBiometricTemplateDeletion(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  now?: Date;
}) {
  const request = await prisma.biometricTemplateDeletionRequest.findFirst({
    where: tenantWhere(input.tenantId, { id: input.requestId }),
  });
  if (!request) throw new BiometricDeletionNotFoundError();
  if (request.status !== "PENDING_APPROVAL") {
    throw new BiometricDeletionStateError("Only a pending biometric deletion request can be approved.");
  }
  if (request.initiatedByUserId === input.actorUserId) {
    throw new BiometricDeletionSelfApprovalError();
  }
  const now = input.now ?? new Date();
  const recoveryExpiresAt = new Date(now.getTime() + request.recoveryDays * 86_400_000);
  const updated = await prisma.biometricTemplateDeletionRequest.update({
    where: { id: request.id },
    data: {
      status: "APPROVED",
      approvedByUserId: input.actorUserId,
      approvedAt: now,
      recoveryExpiresAt,
    },
  });
  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "facialTemplate.deletionApproved",
    entityType: "BiometricTemplateDeletionRequest",
    entityId: request.id,
    afterValue: { recoveryExpiresAt: recoveryExpiresAt.toISOString() },
  });
  return updated;
}

export async function completeBiometricTemplateDeletion(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  now?: Date;
}) {
  const request = await prisma.biometricTemplateDeletionRequest.findFirst({
    where: tenantWhere(input.tenantId, { id: input.requestId }),
  });
  if (!request) throw new BiometricDeletionNotFoundError();
  const now = input.now ?? new Date();
  if (request.status !== "APPROVED" || !request.recoveryExpiresAt) {
    throw new BiometricDeletionStateError("Biometric deletion must be independently approved before completion.");
  }
  if (request.recoveryExpiresAt > now) {
    throw new BiometricDeletionStateError("The approved biometric deletion recovery window has not elapsed.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const template = await tx.driverFacialTemplate.update({
      where: { id: request.templateId },
      data: {
        status: "DELETED",
        templateCiphertext: null,
        templateIv: null,
        templateAuthTag: null,
        encryptionKeyId: null,
        deletedByUserId: input.actorUserId,
        deletedAt: now,
        deletionReason: request.reason,
        materialDeletedAt: now,
      },
    });
    await tx.driver.update({
      where: { id: request.driverId },
      data: { facialVerificationEnrolled: false },
    });
    const completed = await tx.biometricTemplateDeletionRequest.update({
      where: { id: request.id },
      data: { status: "COMPLETED", completedAt: now },
    });
    return { template, request: completed };
  });
  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "facialTemplate.materialDeleted",
    entityType: "BiometricTemplateDeletionRequest",
    entityId: request.id,
    reason: request.reason,
    afterValue: {
      driverId: request.driverId,
      templateId: request.templateId,
      materialRetained: false,
    },
  });
  return result;
}

export async function listBiometricDeletionRequests(
  tenantId: string,
  driverId: string,
) {
  return prisma.biometricTemplateDeletionRequest.findMany({
    where: tenantWhere(tenantId, { driverId }),
    orderBy: { createdAt: "desc" },
  });
}
