-- Phase 8E-003: idempotent retention-expiry notifications.

-- CreateEnum
CREATE TYPE "RetentionNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "RetentionNotificationChannel" AS ENUM ('DEV_CONSOLE', 'NOOP', 'EMAIL');

-- CreateTable
CREATE TABLE "retention_notification_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "milestone" INTEGER NOT NULL,
    "scheduledDeletionAt" TIMESTAMP(3) NOT NULL,
    "status" "RetentionNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "channel" "RetentionNotificationChannel",
    "attemptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_notification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_notification_records_mediaAssetId_milestone_sch_key" ON "retention_notification_records"("mediaAssetId", "milestone", "scheduledDeletionAt");

-- CreateIndex
CREATE INDEX "retention_notification_records_tenantId_idx" ON "retention_notification_records"("tenantId");

-- CreateIndex
CREATE INDEX "retention_notification_records_status_idx" ON "retention_notification_records"("status");

-- AddForeignKey
ALTER TABLE "retention_notification_records" ADD CONSTRAINT "retention_notification_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_notification_records" ADD CONSTRAINT "retention_notification_records_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
