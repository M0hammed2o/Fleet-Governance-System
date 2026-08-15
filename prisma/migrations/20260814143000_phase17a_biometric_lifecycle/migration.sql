-- Phase 17A: provider-neutral facial-verification lifecycle, audit-safe
-- provenance, request idempotency, and dual-control biometric deletion.

ALTER TYPE "DriverFacialTemplateStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "DriverFacialTemplateStatus" ADD VALUE 'DELETED';

CREATE TYPE "FacialLawfulAuthority" AS ENUM ('CONSENT', 'APPROVED_ALTERNATIVE');

ALTER TABLE "driver_facial_templates"
  ALTER COLUMN "templateCiphertext" DROP NOT NULL,
  ALTER COLUMN "templateIv" DROP NOT NULL,
  ALTER COLUMN "templateAuthTag" DROP NOT NULL,
  ALTER COLUMN "encryptionKeyId" DROP NOT NULL,
  ADD COLUMN "version" INTEGER,
  ADD COLUMN "providerId" TEXT NOT NULL DEFAULT 'local-on-device',
  ADD COLUMN "synthetic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "syntheticDisclosure" TEXT,
  ADD COLUMN "lawfulAuthority" "FacialLawfulAuthority" NOT NULL DEFAULT 'CONSENT',
  ADD COLUMN "lawfulAuthorityReference" TEXT,
  ADD COLUMN "noticeVersion" TEXT NOT NULL DEFAULT 'legacy-phase9',
  ADD COLUMN "retentionPolicyVersion" TEXT NOT NULL DEFAULT 'legacy-phase9',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionReason" TEXT,
  ADD COLUMN "materialDeletedAt" TIMESTAMP(3);

WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "driverId" ORDER BY "createdAt" ASC, "id" ASC
  ) AS version
  FROM "driver_facial_templates"
)
UPDATE "driver_facial_templates" AS template
SET "version" = ranked.version
FROM ranked
WHERE template."id" = ranked."id";

ALTER TABLE "driver_facial_templates"
  ALTER COLUMN "version" SET DEFAULT 1,
  ALTER COLUMN "version" SET NOT NULL;

ALTER TABLE "facial_verification_attempts"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "providerId" TEXT NOT NULL DEFAULT 'local-on-device',
  ADD COLUMN "providerVersion" TEXT,
  ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT 'phase9-local-v1',
  ADD COLUMN "synthetic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "syntheticDisclosure" TEXT,
  ADD COLUMN "safeErrorCode" TEXT;

CREATE TABLE "biometric_template_deletion_requests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "initiatedByUserId" TEXT NOT NULL,
  "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "recoveryDays" INTEGER NOT NULL DEFAULT 30,
  "recoveryExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "biometric_template_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_facial_templates_tenantId_driverId_status_idx"
  ON "driver_facial_templates"("tenantId", "driverId", "status");
CREATE UNIQUE INDEX "driver_facial_templates_driverId_version_key"
  ON "driver_facial_templates"("driverId", "version");
CREATE INDEX "facial_verification_attempts_tenantId_gateEventId_attemptedAt_idx"
  ON "facial_verification_attempts"("tenantId", "gateEventId", "attemptedAt");
CREATE UNIQUE INDEX "facial_verification_attempts_tenantId_idempotencyKey_key"
  ON "facial_verification_attempts"("tenantId", "idempotencyKey");
CREATE INDEX "biometric_template_deletion_requests_tenantId_status_idx"
  ON "biometric_template_deletion_requests"("tenantId", "status");
CREATE INDEX "biometric_template_deletion_requests_driverId_idx"
  ON "biometric_template_deletion_requests"("driverId");
CREATE INDEX "biometric_template_deletion_requests_templateId_idx"
  ON "biometric_template_deletion_requests"("templateId");

ALTER TABLE "driver_facial_templates"
  ADD CONSTRAINT "driver_facial_templates_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "biometric_template_deletion_requests"
  ADD CONSTRAINT "biometric_template_deletion_requests_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "biometric_template_deletion_requests"
  ADD CONSTRAINT "biometric_template_deletion_requests_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "drivers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "biometric_template_deletion_requests"
  ADD CONSTRAINT "biometric_template_deletion_requests_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "driver_facial_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "biometric_template_deletion_requests"
  ADD CONSTRAINT "biometric_template_deletion_requests_initiatedByUserId_fkey"
  FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "biometric_template_deletion_requests"
  ADD CONSTRAINT "biometric_template_deletion_requests_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "driver_facial_templates"
  ADD CONSTRAINT "driver_facial_templates_material_lifecycle_check"
  CHECK (
    ("status" = 'DELETED' AND "templateCiphertext" IS NULL AND "templateIv" IS NULL AND "templateAuthTag" IS NULL AND "encryptionKeyId" IS NULL AND "materialDeletedAt" IS NOT NULL)
    OR
    ("status" <> 'DELETED' AND "templateCiphertext" IS NOT NULL AND "templateIv" IS NOT NULL AND "templateAuthTag" IS NOT NULL AND "encryptionKeyId" IS NOT NULL AND "materialDeletedAt" IS NULL)
  );

ALTER TABLE "driver_facial_templates"
  ADD CONSTRAINT "driver_facial_templates_authority_reference_check"
  CHECK (
    "lawfulAuthority" = 'CONSENT'
    OR length(btrim(coalesce("lawfulAuthorityReference", ''))) > 0
  );

ALTER TABLE "facial_verification_attempts"
  ADD CONSTRAINT "facial_verification_attempts_confidence_range_check"
  CHECK ("confidenceScore" IS NULL OR ("confidenceScore" >= 0 AND "confidenceScore" <= 1));

ALTER TABLE "facial_verification_attempts"
  ADD CONSTRAINT "facial_verification_attempts_threshold_range_check"
  CHECK ("threshold" IS NULL OR ("threshold" >= 0 AND "threshold" <= 1));
