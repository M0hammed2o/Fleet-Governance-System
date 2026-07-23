-- CreateEnum
CREATE TYPE "MediaAssetOwnerType" AS ENUM ('GATE_EVENT', 'GATE_EVENT_INSPECTION_ITEM', 'MANUAL_FACIAL_VERIFICATION_FALLBACK', 'DRIVER_PORTRAIT', 'COMPLIANCE_DOCUMENT');

-- CreateEnum
CREATE TYPE "MediaDataClassification" AS ENUM ('RESTRICTED', 'CONFIDENTIAL', 'INTERNAL');

-- AlterTable
ALTER TABLE "compliance_documents" DROP COLUMN "attachmentUrl",
ADD COLUMN     "attachmentMediaAssetId" TEXT;

-- AlterTable
ALTER TABLE "drivers" DROP COLUMN "portraitUrl",
ADD COLUMN     "portraitMediaAssetId" TEXT;

-- AlterTable
ALTER TABLE "gate_event_inspection_items" DROP COLUMN "evidenceRef",
ADD COLUMN     "evidenceMediaAssetId" TEXT;

-- AlterTable
ALTER TABLE "manual_facial_verification_fallbacks" DROP COLUMN "evidenceRef",
ADD COLUMN     "evidenceMediaAssetId" TEXT;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerType" "MediaAssetOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "capturedByUserId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "classification" "MediaDataClassification" NOT NULL DEFAULT 'RESTRICTED',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_idx" ON "media_assets"("tenantId");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_ownerType_ownerId_idx" ON "media_assets"("tenantId", "ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_tenantId_idempotencyKey_key" ON "media_assets"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_documents_attachmentMediaAssetId_key" ON "compliance_documents"("attachmentMediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_portraitMediaAssetId_key" ON "drivers"("portraitMediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "gate_event_inspection_items_evidenceMediaAssetId_key" ON "gate_event_inspection_items"("evidenceMediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "manual_facial_verification_fallbacks_evidenceMediaAssetId_key" ON "manual_facial_verification_fallbacks"("evidenceMediaAssetId");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_portraitMediaAssetId_fkey" FOREIGN KEY ("portraitMediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_facial_verification_fallbacks" ADD CONSTRAINT "manual_facial_verification_fallbacks_evidenceMediaAssetId_fkey" FOREIGN KEY ("evidenceMediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_attachmentMediaAssetId_fkey" FOREIGN KEY ("attachmentMediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_event_inspection_items" ADD CONSTRAINT "gate_event_inspection_items_evidenceMediaAssetId_fkey" FOREIGN KEY ("evidenceMediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

