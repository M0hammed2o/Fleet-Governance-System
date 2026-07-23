-- CreateEnum
CREATE TYPE "GateEventDirection" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "GateEventStatus" AS ENUM ('EXPECTED', 'INSPECTION_STARTED', 'IDENTITY_PENDING', 'IDENTITY_VERIFIED', 'VEHICLE_CHECKS_IN_PROGRESS', 'EXCEPTION_RAISED', 'SUPERVISOR_REVIEW', 'CLEARED', 'DENIED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "GateEventDecision" AS ENUM ('CLEARED', 'DENIED');

-- CreateEnum
CREATE TYPE "InspectionSection" AS ENUM ('DRIVER_AUTHORISATION', 'VEHICLE_IDENTITY', 'EXTERIOR_CONDITION', 'LIGHTS', 'TYRES_WHEELS', 'OPERATIONAL_INFO', 'LOAD_VERIFICATION');

-- CreateEnum
CREATE TYPE "InspectionResponseType" AS ENUM ('CHECK', 'READING', 'TEXT');

-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InspectionOutcome" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE', 'UNABLE_TO_VERIFY');

-- CreateEnum
CREATE TYPE "ExceptionOutcomeAction" AS ENUM ('WARNING', 'MANUAL_REVIEW', 'SUPERVISOR_APPROVAL', 'WORKSHOP_LOCKOUT', 'SECURITY_HOLD', 'DENIED', 'CLEARED_WITH_OBSERVATION');

-- CreateTable
CREATE TABLE "inspection_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "vehicleCategory" "VehicleCategory",
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "section" "InspectionSection" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "responseType" "InspectionResponseType" NOT NULL DEFAULT 'CHECK',
    "unit" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "defaultExceptionSeverity" "ExceptionSeverity",
    "requiresSupervisorApprovalOnFail" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "direction" "GateEventDirection" NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "trailerVehicleId" TEXT,
    "driverId" TEXT NOT NULL,
    "movementAuthorisationId" TEXT NOT NULL,
    "securityOfficerUserId" TEXT NOT NULL,
    "inspectionTemplateId" TEXT,
    "status" "GateEventStatus" NOT NULL DEFAULT 'EXPECTED',
    "identityVerificationResult" TEXT,
    "identityVerificationRef" TEXT,
    "identityVerifiedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "decision" "GateEventDecision",
    "decisionReason" TEXT,
    "decisionByUserId" TEXT,
    "decisionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_event_inspection_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gateEventId" TEXT NOT NULL,
    "inspectionItemId" TEXT NOT NULL,
    "outcome" "InspectionOutcome" NOT NULL,
    "readingValue" TEXT,
    "readingUnit" TEXT,
    "comment" TEXT,
    "exceptionSeverity" "ExceptionSeverity",
    "supervisorApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "evidenceRef" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_event_inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "defaultSeverity" "ExceptionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "defaultOutcomeAction" "ExceptionOutcomeAction" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "requiresSupervisorApproval" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exception_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gateEventId" TEXT NOT NULL,
    "inspectionResultId" TEXT,
    "exceptionTypeId" TEXT,
    "description" TEXT NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "requiresSupervisorApproval" BOOLEAN NOT NULL DEFAULT false,
    "outcomeAction" "ExceptionOutcomeAction",
    "raisedByUserId" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,

    CONSTRAINT "exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspection_templates_tenantId_idx" ON "inspection_templates"("tenantId");

-- CreateIndex
CREATE INDEX "inspection_templates_tenantId_vehicleCategory_isActive_idx" ON "inspection_templates"("tenantId", "vehicleCategory", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_templates_tenantId_name_version_key" ON "inspection_templates"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "inspection_items_templateId_idx" ON "inspection_items"("templateId");

-- CreateIndex
CREATE INDEX "gate_events_tenantId_idx" ON "gate_events"("tenantId");

-- CreateIndex
CREATE INDEX "gate_events_tenantId_status_idx" ON "gate_events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "gate_events_movementAuthorisationId_idx" ON "gate_events"("movementAuthorisationId");

-- CreateIndex
CREATE INDEX "gate_events_vehicleId_idx" ON "gate_events"("vehicleId");

-- CreateIndex
CREATE INDEX "gate_events_tenantId_createdAt_idx" ON "gate_events"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "gate_event_inspection_items_tenantId_idx" ON "gate_event_inspection_items"("tenantId");

-- CreateIndex
CREATE INDEX "gate_event_inspection_items_gateEventId_idx" ON "gate_event_inspection_items"("gateEventId");

-- CreateIndex
CREATE UNIQUE INDEX "gate_event_inspection_items_gateEventId_inspectionItemId_key" ON "gate_event_inspection_items"("gateEventId", "inspectionItemId");

-- CreateIndex
CREATE INDEX "exception_types_tenantId_idx" ON "exception_types"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "exception_types_tenantId_code_key" ON "exception_types"("tenantId", "code");

-- CreateIndex
CREATE INDEX "exceptions_tenantId_idx" ON "exceptions"("tenantId");

-- CreateIndex
CREATE INDEX "exceptions_gateEventId_idx" ON "exceptions"("gateEventId");

-- CreateIndex
CREATE INDEX "exceptions_tenantId_resolvedAt_idx" ON "exceptions"("tenantId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_trailerVehicleId_fkey" FOREIGN KEY ("trailerVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_movementAuthorisationId_fkey" FOREIGN KEY ("movementAuthorisationId") REFERENCES "movement_authorisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_securityOfficerUserId_fkey" FOREIGN KEY ("securityOfficerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_inspectionTemplateId_fkey" FOREIGN KEY ("inspectionTemplateId") REFERENCES "inspection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_decisionByUserId_fkey" FOREIGN KEY ("decisionByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_event_inspection_items" ADD CONSTRAINT "gate_event_inspection_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_event_inspection_items" ADD CONSTRAINT "gate_event_inspection_items_gateEventId_fkey" FOREIGN KEY ("gateEventId") REFERENCES "gate_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_event_inspection_items" ADD CONSTRAINT "gate_event_inspection_items_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "inspection_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_event_inspection_items" ADD CONSTRAINT "gate_event_inspection_items_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_types" ADD CONSTRAINT "exception_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_gateEventId_fkey" FOREIGN KEY ("gateEventId") REFERENCES "gate_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_inspectionResultId_fkey" FOREIGN KEY ("inspectionResultId") REFERENCES "gate_event_inspection_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_exceptionTypeId_fkey" FOREIGN KEY ("exceptionTypeId") REFERENCES "exception_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

