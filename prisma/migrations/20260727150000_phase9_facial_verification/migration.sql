-- CreateEnum
CREATE TYPE "DriverFacialTemplateStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "FacialVerificationResultType" AS ENUM ('MATCH', 'NO_MATCH', 'REVIEW_REQUIRED', 'NOT_ENROLLED', 'CAPTURE_FAILED', 'LIVENESS_FAILED', 'PROVIDER_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "LivenessChallengeResult" AS ENUM ('PASSED', 'FAILED', 'NOT_REQUIRED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FacialVerificationSource" AS ENUM ('ON_DEVICE', 'CLOUD_FALLBACK', 'MANUAL_FALLBACK');

-- CreateTable
CREATE TABLE "driver_facial_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "templateCiphertext" BYTEA NOT NULL,
    "templateIv" BYTEA NOT NULL,
    "templateAuthTag" BYTEA NOT NULL,
    "encryptionKeyId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "status" "DriverFacialTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "consentAcknowledgedAt" TIMESTAMP(3) NOT NULL,
    "enrolledByUserId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_facial_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facial_verification_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gateEventId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "templateId" TEXT,
    "result" "FacialVerificationResultType" NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "templateVersion" TEXT,
    "modelVersion" TEXT,
    "captureQualityScore" DOUBLE PRECISION,
    "livenessResult" "LivenessChallengeResult" NOT NULL DEFAULT 'NOT_REQUIRED',
    "livenessChallenge" TEXT,
    "source" "FacialVerificationSource" NOT NULL DEFAULT 'ON_DEVICE',
    "gateId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "securityOfficerUserId" TEXT NOT NULL,
    "manualFallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "manualFallbackId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facial_verification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_fallback_invocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facialVerificationAttemptId" TEXT,
    "reason" TEXT NOT NULL,
    "invokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_fallback_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_facial_templates_tenantId_idx" ON "driver_facial_templates"("tenantId");

-- CreateIndex
CREATE INDEX "driver_facial_templates_driverId_idx" ON "driver_facial_templates"("driverId");

-- CreateIndex
CREATE INDEX "facial_verification_attempts_tenantId_idx" ON "facial_verification_attempts"("tenantId");

-- CreateIndex
CREATE INDEX "facial_verification_attempts_gateEventId_idx" ON "facial_verification_attempts"("gateEventId");

-- CreateIndex
CREATE INDEX "facial_verification_attempts_driverId_idx" ON "facial_verification_attempts"("driverId");

-- CreateIndex
CREATE INDEX "cloud_fallback_invocations_tenantId_idx" ON "cloud_fallback_invocations"("tenantId");

-- AddForeignKey
ALTER TABLE "driver_facial_templates" ADD CONSTRAINT "driver_facial_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_facial_templates" ADD CONSTRAINT "driver_facial_templates_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_facial_templates" ADD CONSTRAINT "driver_facial_templates_enrolledByUserId_fkey" FOREIGN KEY ("enrolledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_facial_templates" ADD CONSTRAINT "driver_facial_templates_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facial_verification_attempts" ADD CONSTRAINT "facial_verification_attempts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facial_verification_attempts" ADD CONSTRAINT "facial_verification_attempts_gateEventId_fkey" FOREIGN KEY ("gateEventId") REFERENCES "gate_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facial_verification_attempts" ADD CONSTRAINT "facial_verification_attempts_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facial_verification_attempts" ADD CONSTRAINT "facial_verification_attempts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "driver_facial_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facial_verification_attempts" ADD CONSTRAINT "facial_verification_attempts_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facial_verification_attempts" ADD CONSTRAINT "facial_verification_attempts_securityOfficerUserId_fkey" FOREIGN KEY ("securityOfficerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_fallback_invocations" ADD CONSTRAINT "cloud_fallback_invocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "retention_notification_records_mediaAssetId_milestone_sch_key" RENAME TO "retention_notification_records_mediaAssetId_milestone_sched_key";

-- Phase 9C: at most one ACTIVE DriverFacialTemplate per driver, enforced by
-- the database itself — a partial unique index (Prisma's schema DSL has no
-- `WHERE` clause for `@@unique`, same pattern already used for JobRun's
-- one-running-per-jobName guarantee, see that model's own comment in
-- schema.prisma). Re-enrolling a driver must revoke the existing ACTIVE
-- template (status -> REVOKED) in the same transaction as creating the new
-- one, never leave two ACTIVE rows for the same driver.
CREATE UNIQUE INDEX "driver_facial_templates_one_active_per_driver" ON "driver_facial_templates"("driverId") WHERE "status" = 'ACTIVE';
