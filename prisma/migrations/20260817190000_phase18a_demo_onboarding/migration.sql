-- Phase 18A: controlled demo onboarding, richer fleet master data,
-- approved staff placement, private profile media and effective-dated
-- driver-to-vehicle assignment history.

CREATE TYPE "StaffApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ProfessionalPermitStatus" AS ENUM ('NOT_REQUIRED', 'VALID', 'EXPIRED', 'PENDING', 'SUSPENDED');
CREATE TYPE "DriverVehicleAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

ALTER TYPE "VehicleCategory" ADD VALUE 'BAKKIE_PICKUP';
ALTER TYPE "VehicleCategory" ADD VALUE 'VAN';
ALTER TYPE "VehicleCategory" ADD VALUE 'SALES_REPRESENTATIVE';
ALTER TYPE "VehicleCategory" ADD VALUE 'PLANT_EQUIPMENT';
ALTER TYPE "VehicleCategory" ADD VALUE 'OTHER';

ALTER TYPE "MediaAssetOwnerType" ADD VALUE 'VEHICLE_IMAGE';
ALTER TYPE "MediaAssetOwnerType" ADD VALUE 'STAFF_PROFILE';

ALTER TABLE "tenants"
  ADD COLUMN "companyRegistrationNumber" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "departments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "demoWorkspace" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "demoTermsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "demoDisclosureVersion" TEXT;

ALTER TABLE "users"
  ADD COLUMN "employeeNumber" TEXT,
  ADD COLUMN "approvalStatus" "StaffApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "approvalReason" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "assignedSiteId" TEXT,
  ADD COLUMN "assignedGateId" TEXT,
  ADD COLUMN "profileMediaAssetId" TEXT;

ALTER TABLE "drivers"
  ADD COLUMN "licenceIssueDate" TIMESTAMP(3),
  ADD COLUMN "pdpStatus" "ProfessionalPermitStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "notes" TEXT;

ALTER TABLE "vehicles"
  ADD COLUMN "carryingCapacityTonnes" DOUBLE PRECISION,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "serviceIntervalKm" INTEGER,
  ADD COLUMN "nextServiceOdometer" INTEGER,
  ADD COLUMN "nextServiceDate" TIMESTAMP(3),
  ADD COLUMN "imageMediaAssetId" TEXT;

CREATE TABLE "tenant_onboarding" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "currentStep" INTEGER NOT NULL DEFAULT 1,
  "completedSections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "declaredFleetSize" INTEGER,
  "fleetComposition" JSONB,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_onboarding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "driver_vehicle_assignments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "status" "DriverVehicleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "endReason" TEXT,
  "assignedByUserId" TEXT NOT NULL,
  "endedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "driver_vehicle_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_profileMediaAssetId_key" ON "users"("profileMediaAssetId");
CREATE UNIQUE INDEX "vehicles_imageMediaAssetId_key" ON "vehicles"("imageMediaAssetId");
CREATE UNIQUE INDEX "tenant_onboarding_tenantId_key" ON "tenant_onboarding"("tenantId");
CREATE INDEX "driver_vehicle_assignments_tenantId_status_idx" ON "driver_vehicle_assignments"("tenantId", "status");
CREATE INDEX "driver_vehicle_assignments_tenantId_driverId_effectiveFrom_idx" ON "driver_vehicle_assignments"("tenantId", "driverId", "effectiveFrom");
CREATE INDEX "driver_vehicle_assignments_tenantId_vehicleId_effectiveFrom_idx" ON "driver_vehicle_assignments"("tenantId", "vehicleId", "effectiveFrom");

-- PostgreSQL partial indexes provide the race-safe final authority for the
-- single-current-driver/single-current-vehicle rule. Reassignment ends the
-- old row before creating a new one in the same serializable transaction.
CREATE UNIQUE INDEX "driver_vehicle_assignments_one_active_driver"
  ON "driver_vehicle_assignments"("tenantId", "driverId")
  WHERE "status" = 'ACTIVE' AND "effectiveTo" IS NULL;
CREATE UNIQUE INDEX "driver_vehicle_assignments_one_active_vehicle"
  ON "driver_vehicle_assignments"("tenantId", "vehicleId")
  WHERE "status" = 'ACTIVE' AND "effectiveTo" IS NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_assignedSiteId_fkey"
  FOREIGN KEY ("assignedSiteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_assignedGateId_fkey"
  FOREIGN KEY ("assignedGateId") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_profileMediaAssetId_fkey"
  FOREIGN KEY ("profileMediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_imageMediaAssetId_fkey"
  FOREIGN KEY ("imageMediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant_onboarding" ADD CONSTRAINT "tenant_onboarding_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_assignedByUserId_fkey"
  FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_endedByUserId_fkey"
  FOREIGN KEY ("endedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tenant_onboarding" ADD CONSTRAINT "tenant_onboarding_step_range_check"
  CHECK ("currentStep" BETWEEN 1 AND 8);
ALTER TABLE "tenant_onboarding" ADD CONSTRAINT "tenant_onboarding_declared_fleet_size_check"
  CHECK ("declaredFleetSize" IS NULL OR "declaredFleetSize" >= 0);
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_dates_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_carrying_capacity_check"
  CHECK ("carryingCapacityTonnes" IS NULL OR "carryingCapacityTonnes" > 0);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_service_values_check"
  CHECK (("serviceIntervalKm" IS NULL OR "serviceIntervalKm" > 0) AND ("nextServiceOdometer" IS NULL OR "nextServiceOdometer" >= 0));
