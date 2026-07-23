-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('PASSENGER', 'LIGHT_COMMERCIAL', 'TRUCK', 'TRUCK_DUAL_REAR_WHEEL', 'TRAILER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "VehicleOwnership" AS ENUM ('OWNED', 'LEASED', 'CONTRACTOR', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'OTHER');

-- CreateEnum
CREATE TYPE "GpsStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VehicleOperationalStatus" AS ENUM ('OPERATIONAL', 'WORKSHOP_LOCKOUT', 'SECURITY_LOCKOUT', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "ComplianceDocumentOwnerType" AS ENUM ('DRIVER', 'VEHICLE');

-- CreateEnum
CREATE TYPE "ComplianceDocumentType" AS ENUM ('DRIVER_LICENCE', 'PDP', 'VEHICLE_LICENCE', 'ROADWORTHY_CERTIFICATE', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExpiryRuleAction" AS ENUM ('WARN', 'REQUIRE_SUPERVISOR_APPROVAL', 'BLOCK_CLEARANCE');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY', 'EXIT', 'DELIVERY', 'COLLECTION', 'RETURN', 'SITE_TRANSFER', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "allowSelfApproveMovement" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeNumber" TEXT,
    "name" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "portraitUrl" TEXT,
    "department" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "licenceNumber" TEXT,
    "licenceClass" TEXT,
    "licenceExpiry" TIMESTAMP(3),
    "pdpNumber" TEXT,
    "pdpExpiry" TIMESTAMP(3),
    "authorisedVehicleClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restrictions" TEXT,
    "facialVerificationEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "facialVerificationProvider" TEXT,
    "facialVerificationEnrolledAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetNumber" TEXT,
    "registrationNumber" TEXT NOT NULL,
    "vin" TEXT,
    "engineNumber" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "colour" TEXT,
    "category" "VehicleCategory" NOT NULL DEFAULT 'CUSTOM',
    "ownership" "VehicleOwnership" NOT NULL DEFAULT 'OWNED',
    "fuelType" "FuelType",
    "tankCapacityLitres" DOUBLE PRECISION,
    "odometerReading" INTEGER,
    "fuelLevelPercent" DOUBLE PRECISION,
    "assignedDriverId" TEXT,
    "licenceDiscExpiry" TIMESTAMP(3),
    "roadworthyExpiry" TIMESTAMP(3),
    "insuranceExpiry" TIMESTAMP(3),
    "gpsProvider" TEXT,
    "gpsDeviceReference" TEXT,
    "gpsStatus" "GpsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "gpsLastCommunicationAt" TIMESTAMP(3),
    "baselineConditionNotes" TEXT,
    "operationalStatus" "VehicleOperationalStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "tyrePositionConfigId" TEXT,
    "attachedToVehicleId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerType" "ComplianceDocumentOwnerType" NOT NULL,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "documentType" "ComplianceDocumentType" NOT NULL,
    "documentNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "issuer" TEXT,
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_expiry_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentType" "ComplianceDocumentType" NOT NULL,
    "action" "ExpiryRuleAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_expiry_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tyre_position_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tyre_position_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tyre_position_definitions" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tyre_position_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_tyres" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "positionDefinitionId" TEXT NOT NULL,
    "brand" TEXT,
    "size" TEXT,
    "notes" TEXT,
    "fittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_tyres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movement_authorisations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "trailerVehicleId" TEXT,
    "movementType" "MovementType" NOT NULL,
    "purpose" TEXT,
    "destination" TEXT,
    "expectedDepartureAt" TIMESTAMP(3),
    "expectedReturnAt" TIMESTAMP(3),
    "customerProjectJobReference" TEXT,
    "deliveryOrCollectionReference" TEXT,
    "purchaseOrderReference" TEXT,
    "approvedCargoSummary" TEXT,
    "sealOrContainerReference" TEXT,
    "referenceCode" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "approverUserId" TEXT,
    "status" "MovementStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalComments" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movement_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drivers_tenantId_idx" ON "drivers"("tenantId");

-- CreateIndex
CREATE INDEX "vehicles_tenantId_idx" ON "vehicles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenantId_registrationNumber_key" ON "vehicles"("tenantId", "registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenantId_vin_key" ON "vehicles"("tenantId", "vin");

-- CreateIndex
CREATE INDEX "compliance_documents_tenantId_idx" ON "compliance_documents"("tenantId");

-- CreateIndex
CREATE INDEX "compliance_documents_driverId_idx" ON "compliance_documents"("driverId");

-- CreateIndex
CREATE INDEX "compliance_documents_vehicleId_idx" ON "compliance_documents"("vehicleId");

-- CreateIndex
CREATE INDEX "document_expiry_rules_tenantId_idx" ON "document_expiry_rules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "document_expiry_rules_tenantId_documentType_key" ON "document_expiry_rules"("tenantId", "documentType");

-- CreateIndex
CREATE INDEX "tyre_position_configs_tenantId_idx" ON "tyre_position_configs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_position_configs_tenantId_name_key" ON "tyre_position_configs"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_position_definitions_configId_code_key" ON "tyre_position_definitions"("configId", "code");

-- CreateIndex
CREATE INDEX "vehicle_tyres_tenantId_idx" ON "vehicle_tyres"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_tyres_vehicleId_positionDefinitionId_key" ON "vehicle_tyres"("vehicleId", "positionDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "movement_authorisations_referenceCode_key" ON "movement_authorisations"("referenceCode");

-- CreateIndex
CREATE INDEX "movement_authorisations_tenantId_idx" ON "movement_authorisations"("tenantId");

-- CreateIndex
CREATE INDEX "movement_authorisations_tenantId_status_idx" ON "movement_authorisations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "movement_authorisations_vehicleId_idx" ON "movement_authorisations"("vehicleId");

-- CreateIndex
CREATE INDEX "movement_authorisations_driverId_idx" ON "movement_authorisations"("driverId");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tyrePositionConfigId_fkey" FOREIGN KEY ("tyrePositionConfigId") REFERENCES "tyre_position_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_attachedToVehicleId_fkey" FOREIGN KEY ("attachedToVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_expiry_rules" ADD CONSTRAINT "document_expiry_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_position_configs" ADD CONSTRAINT "tyre_position_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_position_definitions" ADD CONSTRAINT "tyre_position_definitions_configId_fkey" FOREIGN KEY ("configId") REFERENCES "tyre_position_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_tyres" ADD CONSTRAINT "vehicle_tyres_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_tyres" ADD CONSTRAINT "vehicle_tyres_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_tyres" ADD CONSTRAINT "vehicle_tyres_positionDefinitionId_fkey" FOREIGN KEY ("positionDefinitionId") REFERENCES "tyre_position_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_trailerVehicleId_fkey" FOREIGN KEY ("trailerVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_authorisations" ADD CONSTRAINT "movement_authorisations_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

