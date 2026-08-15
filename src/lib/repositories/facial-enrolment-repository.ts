import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { encryptTemplate, decryptTemplate } from "@/lib/facial-verification/template-encryption";
import { euclideanDistance, meanDescriptor } from "@/lib/facial-verification/descriptor-math";
import { SYNTHETIC_BIOMETRIC_LABEL } from "@/lib/facial-verification/contracts";
import type { FacialLawfulAuthority } from "@/generated/prisma/client";

/**
 * Driver biometric enrolment (Phase 9C, see FACIAL_VERIFICATION_LICENSING.md
 * for the exact package/model this template format is computed with).
 * Never stores raw enrolment images or video — only the resulting numeric
 * face descriptor, encrypted (lib/facial-verification/template-encryption.ts).
 */

// FACIAL_VERIFICATION_LICENSING.md section 2 — recorded on every template
// row so a future model/package upgrade can identify which generation
// produced it.
export const TEMPLATE_VERSION = "dlib-resnet34-face-recognition-v1";
export const MODEL_VERSION = "@vladmandic/face-api@1.7.15";

export const MIN_ENROLMENT_CAPTURES = 3;
export const MAX_ENROLMENT_CAPTURES = 5;
// Guided captures that don't look like the same face (relative to their own
// mean) fail enrolment outright, rather than silently averaging in a bad
// capture — same distance metric and threshold family as verification
// matching itself (lib/facial-verification/descriptor-math.ts).
export const MAX_INTRA_CAPTURE_DISTANCE = 0.4;

export class DriverNotFoundError extends Error {
  constructor() {
    super("Driver not found.");
    this.name = "DriverNotFoundError";
  }
}
export class ConsentNotAcknowledgedError extends Error {
  constructor() {
    super("The biometric-processing notice and purpose/retention acknowledgement must be confirmed before enrolment.");
    this.name = "ConsentNotAcknowledgedError";
  }
}
export class LawfulAuthorityNotConfirmedError extends Error {
  constructor() {
    super("Consent or an approved alternative lawful authority must be recorded before enrolment.");
    this.name = "LawfulAuthorityNotConfirmedError";
  }
}
export class AlternativeAuthorityReferenceRequiredError extends Error {
  constructor() {
    super("An approved alternative lawful authority requires a non-sensitive decision reference.");
    this.name = "AlternativeAuthorityReferenceRequiredError";
  }
}
export class TemplateMaterialUnavailableError extends Error {
  constructor() {
    super("The active biometric template material is unavailable.");
    this.name = "TemplateMaterialUnavailableError";
  }
}
export class InsufficientCapturesError extends Error {
  constructor(min: number, max: number) {
    super(`Enrolment requires between ${min} and ${max} guided captures.`);
    this.name = "InsufficientCapturesError";
  }
}
export class InconsistentCapturesError extends Error {
  constructor() {
    super("The guided captures do not consistently match — please re-capture, ensuring only one person's face is in frame each time.");
    this.name = "InconsistentCapturesError";
  }
}
export class NoActiveTemplateError extends Error {
  constructor() {
    super("This driver has no active biometric template.");
    this.name = "NoActiveTemplateError";
  }
}

export interface EnrolDriverInput {
  tenantId: string;
  actorUserId: string;
  driverId: string;
  /** One descriptor per guided capture (3-5), computed client-side — see components/facial-enrolment-capture.tsx. */
  captureDescriptors: number[][];
  consentAcknowledged: boolean;
  lawfulAuthority?: FacialLawfulAuthority;
  lawfulAuthorityReference?: string;
  noticeVersion?: string;
  retentionPolicyVersion?: string;
  synthetic?: boolean;
}

/**
 * Enrols (or re-enrols) a driver. Re-enrolment revokes any existing ACTIVE
 * template in the same transaction as creating the new one — the database
 * itself also enforces "at most one ACTIVE template per driver" via a
 * partial unique index (schema.prisma's own comment on DriverFacialTemplate),
 * so this is a hard guarantee, not just an application-level convention.
 */
export async function enrolDriver(input: EnrolDriverInput) {
  const lawfulAuthority = input.lawfulAuthority ?? "CONSENT";
  if (!input.consentAcknowledged) throw new ConsentNotAcknowledgedError();
  if (!lawfulAuthority) throw new LawfulAuthorityNotConfirmedError();
  if (lawfulAuthority === "APPROVED_ALTERNATIVE" && !input.lawfulAuthorityReference?.trim()) {
    throw new AlternativeAuthorityReferenceRequiredError();
  }
  if (input.captureDescriptors.length < MIN_ENROLMENT_CAPTURES || input.captureDescriptors.length > MAX_ENROLMENT_CAPTURES) {
    throw new InsufficientCapturesError(MIN_ENROLMENT_CAPTURES, MAX_ENROLMENT_CAPTURES);
  }

  const driver = await prisma.driver.findFirst({ where: tenantWhere(input.tenantId, { id: input.driverId }) });
  if (!driver) throw new DriverNotFoundError();

  const mean = meanDescriptor(input.captureDescriptors);
  for (const capture of input.captureDescriptors) {
    if (euclideanDistance(capture, mean) > MAX_INTRA_CAPTURE_DISTANCE) throw new InconsistentCapturesError();
  }

  const encrypted = encryptTemplate(mean);
  const now = new Date();

  const created = await prisma.$transaction(async (tx) => {
    const wasAlreadyEnrolled = await tx.driverFacialTemplate.findFirst({ where: { tenantId: input.tenantId, driverId: input.driverId, status: "ACTIVE" } });

    if (wasAlreadyEnrolled) {
      await tx.driverFacialTemplate.update({
        where: { id: wasAlreadyEnrolled.id },
        data: { status: "REVOKED", revokedAt: now, revokedByUserId: input.actorUserId, revokedReason: "Superseded by re-enrolment" },
      });
    }

    const latestVersion = await tx.driverFacialTemplate.aggregate({
      where: { tenantId: input.tenantId, driverId: input.driverId },
      _max: { version: true },
    });
    const version = (latestVersion._max.version ?? 0) + 1;

    const template = await tx.driverFacialTemplate.create({
      data: {
        tenantId: input.tenantId,
        driverId: input.driverId,
        templateCiphertext: Uint8Array.from(encrypted.ciphertext),
        templateIv: Uint8Array.from(encrypted.iv),
        templateAuthTag: Uint8Array.from(encrypted.authTag),
        encryptionKeyId: encrypted.keyId,
        templateVersion: TEMPLATE_VERSION,
        modelVersion: MODEL_VERSION,
        version,
        providerId: input.synthetic ? "genbridge-local-biometric-simulator" : "local-on-device",
        synthetic: input.synthetic ?? false,
        syntheticDisclosure: input.synthetic ? SYNTHETIC_BIOMETRIC_LABEL : null,
        consentAcknowledgedAt: now,
        lawfulAuthority,
        lawfulAuthorityReference: input.lawfulAuthorityReference?.trim() || null,
        noticeVersion: input.noticeVersion?.trim() || "phase17a-biometric-notice-v1",
        retentionPolicyVersion: input.retentionPolicyVersion?.trim() || "phase17a-pending-approval-v1",
        enrolledByUserId: input.actorUserId,
      },
    });

    await tx.driver.update({
      where: { id: input.driverId },
      data: { facialVerificationEnrolled: true, facialVerificationProvider: MODEL_VERSION, facialVerificationEnrolledAt: now },
    });

    return { template, wasReEnrolment: !!wasAlreadyEnrolled };
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: created.wasReEnrolment ? "facialTemplate.reEnrolled" : "facialTemplate.enrolled",
    entityType: "DriverFacialTemplate",
    entityId: created.template.id,
    afterValue: {
      driverId: input.driverId,
      templateVersion: TEMPLATE_VERSION,
      modelVersion: MODEL_VERSION,
      version: created.template.version,
      providerId: created.template.providerId,
      synthetic: created.template.synthetic,
      lawfulAuthority,
      noticeVersion: created.template.noticeVersion,
      retentionPolicyVersion: created.template.retentionPolicyVersion,
      captureCount: input.captureDescriptors.length,
    },
  });

  return created.template;
}

export async function revokeDriverFacialTemplate(tenantId: string, actorUserId: string, driverId: string, reason: string) {
  const active = await prisma.driverFacialTemplate.findFirst({ where: tenantWhere(tenantId, { driverId, status: "ACTIVE" as const }) });
  if (!active) throw new NoActiveTemplateError();

  const updated = await prisma.$transaction(async (tx) => {
    const revoked = await tx.driverFacialTemplate.update({
      where: { id: active.id },
      data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: actorUserId, revokedReason: reason },
    });
    await tx.driver.update({ where: { id: driverId }, data: { facialVerificationEnrolled: false } });
    return revoked;
  });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "facialTemplate.revoked",
    entityType: "DriverFacialTemplate",
    entityId: active.id,
    reason,
  });

  return updated;
}

/** Server-side only — decrypts the descriptor for an in-memory comparison during a verification attempt (Phase 9D). Never returned via any API response. */
export async function getActiveTemplateDescriptorForDriver(tenantId: string, driverId: string): Promise<{ templateId: string; descriptor: number[]; templateVersion: string; modelVersion: string } | null> {
  const active = await prisma.driverFacialTemplate.findFirst({ where: tenantWhere(tenantId, { driverId, status: "ACTIVE" as const }) });
  if (!active) return null;
  if (!active.templateCiphertext || !active.templateIv || !active.templateAuthTag || !active.encryptionKeyId) {
    throw new TemplateMaterialUnavailableError();
  }
  const descriptor = decryptTemplate({
    ciphertext: active.templateCiphertext,
    iv: active.templateIv,
    authTag: active.templateAuthTag,
    keyId: active.encryptionKeyId,
  });
  return { templateId: active.id, descriptor, templateVersion: active.templateVersion, modelVersion: active.modelVersion };
}

/** Status only — never the template bytes, never even in this function's own return shape. */
export interface FacialEnrolmentStatus {
  enrolled: boolean;
  templateVersion: string | null;
  modelVersion: string | null;
  enrolledAt: Date | null;
  enrolledByUserId: string | null;
  version: number | null;
  providerId: string | null;
  synthetic: boolean;
  lawfulAuthority: FacialLawfulAuthority | null;
  noticeVersion: string | null;
  retentionPolicyVersion: string | null;
}

export async function getFacialEnrolmentStatus(tenantId: string, driverId: string): Promise<FacialEnrolmentStatus> {
  const active = await prisma.driverFacialTemplate.findFirst({ where: tenantWhere(tenantId, { driverId, status: "ACTIVE" as const }) });
  if (!active) return {
    enrolled: false,
    templateVersion: null,
    modelVersion: null,
    enrolledAt: null,
    enrolledByUserId: null,
    version: null,
    providerId: null,
    synthetic: false,
    lawfulAuthority: null,
    noticeVersion: null,
    retentionPolicyVersion: null,
  };
  return {
    enrolled: true,
    templateVersion: active.templateVersion,
    modelVersion: active.modelVersion,
    enrolledAt: active.enrolledAt,
    enrolledByUserId: active.enrolledByUserId,
    version: active.version,
    providerId: active.providerId,
    synthetic: active.synthetic,
    lawfulAuthority: active.lawfulAuthority,
    noticeVersion: active.noticeVersion,
    retentionPolicyVersion: active.retentionPolicyVersion,
  };
}

/** Full audit history (enrolments + revocations) — status metadata only, never template bytes. */
export async function listFacialTemplateHistoryForDriver(tenantId: string, driverId: string) {
  const rows = await prisma.driverFacialTemplate.findMany({
    where: tenantWhere(tenantId, { driverId }),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      templateVersion: true,
      modelVersion: true,
      version: true,
      providerId: true,
      synthetic: true,
      syntheticDisclosure: true,
      lawfulAuthority: true,
      lawfulAuthorityReference: true,
      noticeVersion: true,
      retentionPolicyVersion: true,
      expiresAt: true,
      consentAcknowledgedAt: true,
      enrolledByUserId: true,
      enrolledAt: true,
      revokedByUserId: true,
      revokedAt: true,
      revokedReason: true,
      deletedByUserId: true,
      deletedAt: true,
      deletionReason: true,
      materialDeletedAt: true,
    },
  });
  return rows;
}
