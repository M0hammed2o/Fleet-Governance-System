-- CreateEnum
CREATE TYPE "RetentionAssetStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'PENDING_DELETION', 'DELETED');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'IN_RECOVERY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExportRequestStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "binaryDeletedAt" TIMESTAMP(3),
ADD COLUMN     "investigationHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retentionStatus" "RetentionAssetStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "scheduledDeletionAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" "MediaCategory" NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "includedStorageAllowanceBytes" DOUBLE PRECISION,
    "archiveEligible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categories" "MediaCategory"[],
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "initiatedByUserId" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "recoveryDays" INTEGER NOT NULL DEFAULT 30,
    "recoveryExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assetCount" INTEGER,
    "totalBytes" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_request_assets" (
    "id" TEXT NOT NULL,
    "deletionRequestId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,

    CONSTRAINT "deletion_request_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_certificates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deletionRequestId" TEXT NOT NULL,
    "categories" "MediaCategory"[],
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "assetCount" INTEGER NOT NULL,
    "totalBytes" DOUBLE PRECISION NOT NULL,
    "initiatedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "checksumManifest" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categories" "MediaCategory"[],
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "status" "ExportRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manifest" JSONB,
    "expiresAt" TIMESTAMP(3),
    "assetCount" INTEGER,
    "totalBytes" DOUBLE PRECISION,

    CONSTRAINT "export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retention_policies_tenantId_idx" ON "retention_policies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_tenantId_category_key" ON "retention_policies"("tenantId", "category");

-- CreateIndex
CREATE INDEX "deletion_requests_tenantId_idx" ON "deletion_requests"("tenantId");

-- CreateIndex
CREATE INDEX "deletion_requests_tenantId_status_idx" ON "deletion_requests"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_request_assets_deletionRequestId_mediaAssetId_key" ON "deletion_request_assets"("deletionRequestId", "mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_certificates_deletionRequestId_key" ON "deletion_certificates"("deletionRequestId");

-- CreateIndex
CREATE INDEX "export_requests_tenantId_idx" ON "export_requests"("tenantId");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_retentionStatus_scheduledDeletionAt_idx" ON "media_assets"("tenantId", "retentionStatus", "scheduledDeletionAt");

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_request_assets" ADD CONSTRAINT "deletion_request_assets_deletionRequestId_fkey" FOREIGN KEY ("deletionRequestId") REFERENCES "deletion_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_request_assets" ADD CONSTRAINT "deletion_request_assets_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_deletionRequestId_fkey" FOREIGN KEY ("deletionRequestId") REFERENCES "deletion_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_requests" ADD CONSTRAINT "export_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_requests" ADD CONSTRAINT "export_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

