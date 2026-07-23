-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('NO_DISCREPANCIES', 'OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DiscrepancyCategory" AS ENUM ('ODOMETER', 'FUEL', 'VEHICLE_CONDITION', 'TYRE_CONDITION', 'CARGO_AND_LOAD');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "movement_authorisations" ADD COLUMN     "expectedDistanceKm" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "movementAuthorisationId" TEXT NOT NULL,
    "departureGateEventId" TEXT NOT NULL,
    "returnGateEventId" TEXT NOT NULL,
    "departureOdometer" INTEGER,
    "returnOdometer" INTEGER,
    "kmTravelled" INTEGER,
    "departureFuelPercent" DOUBLE PRECISION,
    "returnFuelPercent" DOUBLE PRECISION,
    "fuelDeltaPercent" DOUBLE PRECISION,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'NO_DISCREPANCIES',
    "builtByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_discrepancies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "category" "DiscrepancyCategory" NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "departureValue" TEXT,
    "returnValue" TEXT,
    "deltaValue" DOUBLE PRECISION,
    "inspectionItemId" TEXT,
    "linkedExceptionId" TEXT,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "correctiveAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_movementAuthorisationId_key" ON "reconciliations"("movementAuthorisationId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_departureGateEventId_key" ON "reconciliations"("departureGateEventId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_returnGateEventId_key" ON "reconciliations"("returnGateEventId");

-- CreateIndex
CREATE INDEX "reconciliations_tenantId_idx" ON "reconciliations"("tenantId");

-- CreateIndex
CREATE INDEX "reconciliations_tenantId_status_idx" ON "reconciliations"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_discrepancies_linkedExceptionId_key" ON "reconciliation_discrepancies"("linkedExceptionId");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_tenantId_idx" ON "reconciliation_discrepancies"("tenantId");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_reconciliationId_idx" ON "reconciliation_discrepancies"("reconciliationId");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_tenantId_status_idx" ON "reconciliation_discrepancies"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_movementAuthorisationId_fkey" FOREIGN KEY ("movementAuthorisationId") REFERENCES "movement_authorisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_departureGateEventId_fkey" FOREIGN KEY ("departureGateEventId") REFERENCES "gate_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_returnGateEventId_fkey" FOREIGN KEY ("returnGateEventId") REFERENCES "gate_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_builtByUserId_fkey" FOREIGN KEY ("builtByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "inspection_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_linkedExceptionId_fkey" FOREIGN KEY ("linkedExceptionId") REFERENCES "exceptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
