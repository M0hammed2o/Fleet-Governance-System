-- CreateEnum
CREATE TYPE "MediaCategory" AS ENUM ('DRIVER_PORTRAIT', 'FACIAL_AUDIT', 'VEHICLE_INSPECTION_PHOTO', 'VEHICLE_INSPECTION_VIDEO', 'DAMAGE_EVIDENCE', 'CARGO_EVIDENCE', 'DELIVERY_DOCUMENT', 'INVESTIGATION_EVIDENCE', 'GENERATED_REPORT', 'OTHER_DOCUMENT');

-- CreateEnum
CREATE TYPE "MediaUploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "captureMetadata" JSONB,
ADD COLUMN     "category" "MediaCategory" NOT NULL DEFAULT 'OTHER_DOCUMENT',
ADD COLUMN     "compressionProfile" TEXT,
ADD COLUMN     "originalStorageKey" TEXT,
ADD COLUMN     "storageProvider" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN     "thumbnailStorageKey" TEXT,
ADD COLUMN     "uploadStatus" "MediaUploadStatus" NOT NULL DEFAULT 'READY';

-- Backfill: the one unambiguous pre-existing ownerType -> category mapping.
-- Every other existing row keeps the column default (OTHER_DOCUMENT) — there
-- is no reliable way to infer VEHICLE_INSPECTION_PHOTO vs DAMAGE_EVIDENCE
-- etc. from ownerType alone (GATE_EVENT_INSPECTION_ITEM evidence could be
-- either), so those are left for a human to reclassify later rather than
-- guessed.
UPDATE "media_assets" SET "category" = 'DRIVER_PORTRAIT' WHERE "ownerType" = 'DRIVER_PORTRAIT';
