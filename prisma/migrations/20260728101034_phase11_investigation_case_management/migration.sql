-- CreateEnum
CREATE TYPE "InvestigationSource" AS ENUM ('GATE_EXCEPTION', 'FACIAL_VERIFICATION_FAILURE', 'VEHICLE_INSPECTION_FAILURE', 'CARGO_LOAD_DISCREPANCY', 'RECONCILIATION_DISCREPANCY', 'GPS_GEOFENCE_EXCEPTION', 'MISSING_EVIDENCE', 'SUSPECTED_UNAUTHORISED_USE', 'ODOMETER_FUEL_CONDITION_DISCREPANCY', 'MANUAL_CONCERN', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestigationCategory" AS ENUM ('FRAUD', 'THEFT', 'SAFETY', 'POLICY_VIOLATION', 'MISCONDUCT', 'DATA_INTEGRITY', 'UNAUTHORISED_USE', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('DRAFT', 'OPEN', 'TRIAGE', 'UNDER_INVESTIGATION', 'AWAITING_INFORMATION', 'AWAITING_APPROVAL', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "InvestigationOutcome" AS ENUM ('NOT_DETERMINED', 'SUBSTANTIATED', 'UNSUBSTANTIATED', 'INCONCLUSIVE', 'REFERRED_FOR_FURTHER_ACTION');

-- CreateEnum
CREATE TYPE "InvestigationConfidentiality" AS ENUM ('STANDARD', 'RESTRICTED', 'HIGHLY_RESTRICTED');

-- CreateEnum
CREATE TYPE "InvestigationPartyRole" AS ENUM ('SUBJECT', 'WITNESS', 'OTHER_INVOLVED_PARTY');

-- CreateEnum
CREATE TYPE "InvestigationRelatedRecordType" AS ENUM ('EXCEPTION', 'GATE_EVENT', 'GATE_EVENT_INSPECTION_ITEM', 'MOVEMENT_AUTHORISATION', 'RECONCILIATION', 'RECONCILIATION_DISCREPANCY', 'FACIAL_VERIFICATION_ATTEMPT', 'TELEMATICS_EVENT', 'VEHICLE', 'DRIVER', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestigationNoteType" AS ENUM ('GENERAL', 'INTERVIEW', 'ANALYSIS', 'DECISION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InvestigationTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvestigationFindingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED_FOR_AMENDMENT', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvestigationApprovalAction" AS ENUM ('SUBMIT', 'APPROVE', 'RETURN_FOR_AMENDMENT', 'REJECT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaAssetOwnerType" ADD VALUE 'INVESTIGATION_CASE';
ALTER TYPE "MediaAssetOwnerType" ADD VALUE 'INVESTIGATION_REPORT';

-- CreateTable
CREATE TABLE "tenant_investigation_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "casePrefix" TEXT NOT NULL DEFAULT 'INV',
    "enforceSeparationOfDuties" BOOLEAN NOT NULL DEFAULT true,
    "requireDualApprovalForHighSeverityHoldRelease" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_investigation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_case_sequences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "investigation_case_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_cases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "InvestigationSource" NOT NULL,
    "category" "InvestigationCategory",
    "priority" "ExceptionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "InvestigationStatus" NOT NULL DEFAULT 'DRAFT',
    "outcome" "InvestigationOutcome" NOT NULL DEFAULT 'NOT_DETERMINED',
    "confidentiality" "InvestigationConfidentiality" NOT NULL DEFAULT 'STANDARD',
    "reportingPersonUserId" TEXT,
    "reportingPersonName" TEXT,
    "assignedInvestigatorUserId" TEXT,
    "caseOwnerUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "triagedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "evidenceHoldActive" BOOLEAN NOT NULL DEFAULT true,
    "evidenceHoldReleasedAt" TIMESTAMP(3),
    "evidenceHoldReleasedByUserId" TEXT,
    "evidenceHoldReleaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investigation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_subjects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "role" "InvestigationPartyRole" NOT NULL,
    "userId" TEXT,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "contractorName" TEXT,
    "department" TEXT,
    "site" TEXT,
    "notes" TEXT,
    "explanationResponse" TEXT,
    "explanationRespondedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_related_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "recordType" "InvestigationRelatedRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "snapshotSummary" JSONB NOT NULL,
    "isReferralSource" BOOLEAN NOT NULL DEFAULT false,
    "linkedByUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_related_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "noteType" "InvestigationNoteType" NOT NULL DEFAULT 'GENERAL',
    "confidentiality" "InvestigationConfidentiality" NOT NULL DEFAULT 'STANDARD',
    "content" TEXT NOT NULL,
    "supersedesNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignedToUserId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "InvestigationTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completionNote" TEXT,
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investigation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_findings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "detailedFindings" TEXT NOT NULL,
    "evidenceRelied" TEXT,
    "contradictoryEvidence" TEXT,
    "subjectResponseSummary" TEXT,
    "outcome" "InvestigationOutcome" NOT NULL,
    "recommendations" TEXT,
    "correctiveActions" TEXT,
    "controlWeaknesses" TEXT,
    "followUpDate" TIMESTAMP(3),
    "status" "InvestigationFindingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "investigation_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_approvals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "action" "InvestigationApprovalAction" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_evidence_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "evidenceNumber" INTEGER NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceRecordType" TEXT,
    "sourceRecordId" TEXT,
    "relevance" TEXT,
    "confidentiality" "InvestigationConfidentiality" NOT NULL DEFAULT 'STANDARD',
    "addedByUserId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredInError" BOOLEAN NOT NULL DEFAULT false,
    "enteredInErrorReason" TEXT,
    "enteredInErrorByUserId" TEXT,
    "enteredInErrorAt" TIMESTAMP(3),

    CONSTRAINT "investigation_evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_chronology_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_chronology_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_auditor_access_grants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalAuditorUserId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "canDownloadReport" BOOLEAN NOT NULL DEFAULT false,
    "canDownloadEvidence" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_auditor_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_auditor_access_grant_cases" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,

    CONSTRAINT "external_auditor_access_grant_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_auditor_access_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_auditor_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_investigation_settings_tenantId_key" ON "tenant_investigation_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_case_sequences_tenantId_year_key" ON "investigation_case_sequences"("tenantId", "year");

-- CreateIndex
CREATE INDEX "investigation_cases_tenantId_status_idx" ON "investigation_cases"("tenantId", "status");

-- CreateIndex
CREATE INDEX "investigation_cases_tenantId_assignedInvestigatorUserId_idx" ON "investigation_cases"("tenantId", "assignedInvestigatorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_cases_tenantId_caseNumber_key" ON "investigation_cases"("tenantId", "caseNumber");

-- CreateIndex
CREATE INDEX "investigation_subjects_tenantId_caseId_idx" ON "investigation_subjects"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "investigation_subjects_userId_idx" ON "investigation_subjects"("userId");

-- CreateIndex
CREATE INDEX "investigation_subjects_driverId_idx" ON "investigation_subjects"("driverId");

-- CreateIndex
CREATE INDEX "investigation_subjects_vehicleId_idx" ON "investigation_subjects"("vehicleId");

-- CreateIndex
CREATE INDEX "investigation_related_records_tenantId_recordType_recordId_idx" ON "investigation_related_records"("tenantId", "recordType", "recordId");

-- CreateIndex
CREATE INDEX "investigation_related_records_tenantId_caseId_idx" ON "investigation_related_records"("tenantId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_notes_supersedesNoteId_key" ON "investigation_notes"("supersedesNoteId");

-- CreateIndex
CREATE INDEX "investigation_notes_tenantId_caseId_createdAt_idx" ON "investigation_notes"("tenantId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "investigation_tasks_tenantId_caseId_idx" ON "investigation_tasks"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "investigation_tasks_tenantId_assignedToUserId_status_idx" ON "investigation_tasks"("tenantId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "investigation_findings_tenantId_caseId_idx" ON "investigation_findings"("tenantId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_findings_caseId_version_key" ON "investigation_findings"("caseId", "version");

-- CreateIndex
CREATE INDEX "investigation_approvals_tenantId_caseId_idx" ON "investigation_approvals"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "investigation_approvals_findingId_idx" ON "investigation_approvals"("findingId");

-- CreateIndex
CREATE INDEX "investigation_evidence_links_tenantId_caseId_idx" ON "investigation_evidence_links"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "investigation_evidence_links_mediaAssetId_idx" ON "investigation_evidence_links"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_evidence_links_caseId_evidenceNumber_key" ON "investigation_evidence_links"("caseId", "evidenceNumber");

-- CreateIndex
CREATE INDEX "investigation_chronology_events_tenantId_caseId_occurredAt_idx" ON "investigation_chronology_events"("tenantId", "caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "external_auditor_access_grants_tenantId_externalAuditorUser_idx" ON "external_auditor_access_grants"("tenantId", "externalAuditorUserId");

-- CreateIndex
CREATE INDEX "external_auditor_access_grant_cases_caseId_idx" ON "external_auditor_access_grant_cases"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "external_auditor_access_grant_cases_grantId_caseId_key" ON "external_auditor_access_grant_cases"("grantId", "caseId");

-- CreateIndex
CREATE INDEX "external_auditor_access_logs_tenantId_grantId_idx" ON "external_auditor_access_logs"("tenantId", "grantId");

-- CreateIndex
CREATE INDEX "external_auditor_access_logs_tenantId_caseId_idx" ON "external_auditor_access_logs"("tenantId", "caseId");

-- AddForeignKey
ALTER TABLE "tenant_investigation_settings" ADD CONSTRAINT "tenant_investigation_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_case_sequences" ADD CONSTRAINT "investigation_case_sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_reportingPersonUserId_fkey" FOREIGN KEY ("reportingPersonUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_assignedInvestigatorUserId_fkey" FOREIGN KEY ("assignedInvestigatorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_caseOwnerUserId_fkey" FOREIGN KEY ("caseOwnerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_reopenedByUserId_fkey" FOREIGN KEY ("reopenedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_cases" ADD CONSTRAINT "investigation_cases_evidenceHoldReleasedByUserId_fkey" FOREIGN KEY ("evidenceHoldReleasedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_subjects" ADD CONSTRAINT "investigation_subjects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_subjects" ADD CONSTRAINT "investigation_subjects_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_subjects" ADD CONSTRAINT "investigation_subjects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_subjects" ADD CONSTRAINT "investigation_subjects_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_subjects" ADD CONSTRAINT "investigation_subjects_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_subjects" ADD CONSTRAINT "investigation_subjects_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_related_records" ADD CONSTRAINT "investigation_related_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_related_records" ADD CONSTRAINT "investigation_related_records_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_related_records" ADD CONSTRAINT "investigation_related_records_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_supersedesNoteId_fkey" FOREIGN KEY ("supersedesNoteId") REFERENCES "investigation_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_findings" ADD CONSTRAINT "investigation_findings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_findings" ADD CONSTRAINT "investigation_findings_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_findings" ADD CONSTRAINT "investigation_findings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_findings" ADD CONSTRAINT "investigation_findings_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_approvals" ADD CONSTRAINT "investigation_approvals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_approvals" ADD CONSTRAINT "investigation_approvals_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_approvals" ADD CONSTRAINT "investigation_approvals_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "investigation_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_approvals" ADD CONSTRAINT "investigation_approvals_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_evidence_links" ADD CONSTRAINT "investigation_evidence_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_evidence_links" ADD CONSTRAINT "investigation_evidence_links_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_evidence_links" ADD CONSTRAINT "investigation_evidence_links_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_evidence_links" ADD CONSTRAINT "investigation_evidence_links_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_evidence_links" ADD CONSTRAINT "investigation_evidence_links_enteredInErrorByUserId_fkey" FOREIGN KEY ("enteredInErrorByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_chronology_events" ADD CONSTRAINT "investigation_chronology_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_chronology_events" ADD CONSTRAINT "investigation_chronology_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_chronology_events" ADD CONSTRAINT "investigation_chronology_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_grants" ADD CONSTRAINT "external_auditor_access_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_grants" ADD CONSTRAINT "external_auditor_access_grants_externalAuditorUserId_fkey" FOREIGN KEY ("externalAuditorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_grants" ADD CONSTRAINT "external_auditor_access_grants_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_grants" ADD CONSTRAINT "external_auditor_access_grants_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_grant_cases" ADD CONSTRAINT "external_auditor_access_grant_cases_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "external_auditor_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_grant_cases" ADD CONSTRAINT "external_auditor_access_grant_cases_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_logs" ADD CONSTRAINT "external_auditor_access_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_logs" ADD CONSTRAINT "external_auditor_access_logs_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "external_auditor_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_logs" ADD CONSTRAINT "external_auditor_access_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_auditor_access_logs" ADD CONSTRAINT "external_auditor_access_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
