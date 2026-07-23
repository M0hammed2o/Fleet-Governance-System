-- CreateEnum
CREATE TYPE "ManualFallbackStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- CreateTable
CREATE TABLE "manual_facial_verification_fallbacks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "status" "ManualFallbackStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceRef" TEXT,
    "relatedGateEventId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "manual_facial_verification_fallbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_facial_verification_fallbacks_tenantId_idx" ON "manual_facial_verification_fallbacks"("tenantId");

-- CreateIndex
CREATE INDEX "manual_facial_verification_fallbacks_driverId_idx" ON "manual_facial_verification_fallbacks"("driverId");

-- AddForeignKey
ALTER TABLE "manual_facial_verification_fallbacks" ADD CONSTRAINT "manual_facial_verification_fallbacks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_facial_verification_fallbacks" ADD CONSTRAINT "manual_facial_verification_fallbacks_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_facial_verification_fallbacks" ADD CONSTRAINT "manual_facial_verification_fallbacks_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_facial_verification_fallbacks" ADD CONSTRAINT "manual_facial_verification_fallbacks_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

