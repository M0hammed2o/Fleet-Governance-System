-- CreateEnum
CREATE TYPE "TelematicsEventSource" AS ENUM ('PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "ManualGpsConfirmationStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "VehicleUsePolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED');

-- AlterTable
ALTER TABLE "exceptions" ADD COLUMN     "vehicleId" TEXT,
ALTER COLUMN "gateEventId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "telematics_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "source" "TelematicsEventSource" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "headingDegrees" DOUBLE PRECISION,
    "ignitionOn" BOOLEAN,
    "odometerKm" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerReference" TEXT,

    CONSTRAINT "telematics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerLatitude" DOUBLE PRECISION NOT NULL,
    "centerLongitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" DOUBLE PRECISION NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_gps_confirmations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "positionDescription" TEXT NOT NULL,
    "status" "ManualGpsConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,

    CONSTRAINT "manual_gps_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_use_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "permittedDaysOfWeek" INTEGER[],
    "permittedStartTime" TEXT,
    "permittedEndTime" TEXT,
    "approvedDestination" TEXT,
    "approvedGeofenceId" TEXT,
    "kmLimitPerTrip" DOUBLE PRECISION,
    "kmLimitPerDay" DOUBLE PRECISION,
    "kmLimitPerWeek" DOUBLE PRECISION,
    "kmLimitPerMonth" DOUBLE PRECISION,
    "allowAfterHours" BOOLEAN NOT NULL DEFAULT false,
    "allowWeekend" BOOLEAN NOT NULL DEFAULT false,
    "allowPrivateUse" BOOLEAN NOT NULL DEFAULT false,
    "privateUseKmAllowanceKm" DOUBLE PRECISION,
    "expectedReturnTime" TEXT,
    "approvingManagerUserId" TEXT,
    "status" "VehicleUsePolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_use_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_use_policy_vehicles" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_use_policy_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telematics_events_tenantId_idx" ON "telematics_events"("tenantId");

-- CreateIndex
CREATE INDEX "telematics_events_tenantId_vehicleId_recordedAt_idx" ON "telematics_events"("tenantId", "vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "geofences_tenantId_idx" ON "geofences"("tenantId");

-- CreateIndex
CREATE INDEX "manual_gps_confirmations_tenantId_idx" ON "manual_gps_confirmations"("tenantId");

-- CreateIndex
CREATE INDEX "manual_gps_confirmations_tenantId_vehicleId_idx" ON "manual_gps_confirmations"("tenantId", "vehicleId");

-- CreateIndex
CREATE INDEX "vehicle_use_policies_tenantId_idx" ON "vehicle_use_policies"("tenantId");

-- CreateIndex
CREATE INDEX "vehicle_use_policies_tenantId_status_idx" ON "vehicle_use_policies"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_use_policy_vehicles_policyId_vehicleId_key" ON "vehicle_use_policy_vehicles"("policyId", "vehicleId");

-- DataMigration: MovementAuthorisation.vehicleUsePolicyId was a plain,
-- unvalidated String from Phase 5C (DECISIONS.md D-019) — any pre-existing
-- value cannot reference a real VehicleUsePolicy row (that table is brand
-- new in this migration, currently empty), so it is cleared rather than
-- left to violate the FK constraint being added below.
UPDATE "movement_authorisations" SET "vehicleUsePolicyId" = NULL WHERE "vehicleUsePolicyId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_vehicleUsePolicyId_fkey" FOREIGN KEY ("vehicleUsePolicyId") REFERENCES "vehicle_use_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telematics_events" ADD CONSTRAINT "telematics_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telematics_events" ADD CONSTRAINT "telematics_events_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_gps_confirmations" ADD CONSTRAINT "manual_gps_confirmations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_gps_confirmations" ADD CONSTRAINT "manual_gps_confirmations_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_gps_confirmations" ADD CONSTRAINT "manual_gps_confirmations_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_gps_confirmations" ADD CONSTRAINT "manual_gps_confirmations_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_use_policies" ADD CONSTRAINT "vehicle_use_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_use_policies" ADD CONSTRAINT "vehicle_use_policies_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_use_policies" ADD CONSTRAINT "vehicle_use_policies_approvedGeofenceId_fkey" FOREIGN KEY ("approvedGeofenceId") REFERENCES "geofences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_use_policies" ADD CONSTRAINT "vehicle_use_policies_approvingManagerUserId_fkey" FOREIGN KEY ("approvingManagerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_use_policy_vehicles" ADD CONSTRAINT "vehicle_use_policy_vehicles_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vehicle_use_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_use_policy_vehicles" ADD CONSTRAINT "vehicle_use_policy_vehicles_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
