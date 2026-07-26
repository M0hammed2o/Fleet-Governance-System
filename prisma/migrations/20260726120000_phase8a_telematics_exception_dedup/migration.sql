-- AlterTable
ALTER TABLE "exceptions" ADD COLUMN     "lastObservedAt" TIMESTAMP(3),
ADD COLUMN     "observationCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "violationType" TEXT;

-- CreateIndex
CREATE INDEX "exceptions_vehicleId_violationType_resolvedAt_idx" ON "exceptions"("vehicleId", "violationType", "resolvedAt");
