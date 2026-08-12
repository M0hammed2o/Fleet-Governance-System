-- CreateEnum
CREATE TYPE "TrackerMappingSource" AS ENUM ('SYNTHETIC', 'LIVE_PROVIDER');

-- CreateEnum
CREATE TYPE "TrackerCollectionMethod" AS ENUM ('POLLING', 'WEBHOOK', 'MANUAL', 'SIMULATOR');

-- CreateEnum
CREATE TYPE "TrackerFreshnessState" AS ENUM ('FRESH', 'STALE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "TrackerMappingState" AS ENUM ('MAPPED', 'UNMAPPED', 'AMBIGUOUS', 'REVOKED');

-- CreateEnum
CREATE TYPE "TrackerProcessingStatus" AS ENUM ('ACCEPTED', 'DUPLICATE', 'QUARANTINED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TrackerCorrectionStatus" AS ENUM ('ORIGINAL', 'CORRECTED', 'SUPERSEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TelematicsEventSource" ADD VALUE 'SYNTHETIC';
ALTER TYPE "TelematicsEventSource" ADD VALUE 'ESTIMATED';
ALTER TYPE "TelematicsEventSource" ADD VALUE 'UNAVAILABLE';

-- AlterTable
ALTER TABLE "telematics_events" ADD COLUMN     "accuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "collectionMethod" "TrackerCollectionMethod" NOT NULL DEFAULT 'POLLING',
ADD COLUMN     "confidenceLimitations" TEXT,
ADD COLUMN     "correctionStatus" "TrackerCorrectionStatus" NOT NULL DEFAULT 'ORIGINAL',
ADD COLUMN     "freshness" "TrackerFreshnessState" NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN     "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mappingState" "TrackerMappingState" NOT NULL DEFAULT 'UNMAPPED',
ADD COLUMN     "normalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "processingStatus" "TrackerProcessingStatus" NOT NULL DEFAULT 'ACCEPTED',
ADD COLUMN     "providerEventId" TEXT,
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "trackerMappingId" TEXT;

-- CreateTable
CREATE TABLE "tracker_vehicle_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerAssetId" TEXT NOT NULL,
    "source" "TrackerMappingSource" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "endedByUserId" TEXT,
    "correctionOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracker_vehicle_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracker_vehicle_mappings_tenantId_vehicleId_effectiveFrom_idx" ON "tracker_vehicle_mappings"("tenantId", "vehicleId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "tracker_vehicle_mappings_tenantId_providerId_providerAssetI_idx" ON "tracker_vehicle_mappings"("tenantId", "providerId", "providerAssetId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "tracker_vehicle_mappings_correctionOfId_idx" ON "tracker_vehicle_mappings"("correctionOfId");

-- CreateIndex
CREATE INDEX "telematics_events_tenantId_providerId_providerEventId_idx" ON "telematics_events"("tenantId", "providerId", "providerEventId");

-- CreateIndex
CREATE INDEX "telematics_events_trackerMappingId_recordedAt_idx" ON "telematics_events"("trackerMappingId", "recordedAt");

-- AddForeignKey
ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "tracker_vehicle_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telematics_events" ADD CONSTRAINT "telematics_events_trackerMappingId_fkey" FOREIGN KEY ("trackerMappingId") REFERENCES "tracker_vehicle_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
