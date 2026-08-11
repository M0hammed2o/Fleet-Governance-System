-- Phase 12: persisted, versioned deterministic analytics rules and
-- explainable human-review indicators. No historical migration is edited.

ALTER TYPE "MediaAssetOwnerType" ADD VALUE 'GOVERNANCE_ANALYTICS_REPORT';

CREATE TYPE "AnalyticsSubjectType" AS ENUM ('TENANT', 'SITE', 'GATE', 'VEHICLE', 'DRIVER', 'MOVEMENT');
CREATE TYPE "AnalyticsDataQuality" AS ENUM ('COMPLETE', 'INCOMPLETE', 'MOCK', 'MANUAL', 'MIXED', 'UNAVAILABLE');
CREATE TYPE "AnalyticsIndicatorStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED', 'ESCALATED');
CREATE TYPE "AnalyticsCalculationStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "analytics_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "evaluationPeriodDays" INTEGER NOT NULL DEFAULT 30,
    "minimumOccurrenceCount" INTEGER NOT NULL DEFAULT 3,
    "severity" "ExceptionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "percentageThreshold" DOUBLE PRECISION,
    "numericThreshold" DOUBLE PRECISION,
    "operatingHourStart" TEXT,
    "operatingHourEnd" TEXT,
    "staleDataHours" INTEGER,
    "baselinePeriodDays" INTEGER,
    "minimumSampleSize" INTEGER NOT NULL DEFAULT 3,
    "cooldownDays" INTEGER NOT NULL DEFAULT 7,
    "configuredByUserId" TEXT NOT NULL,
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    CONSTRAINT "analytics_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_indicators" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "evaluationStart" TIMESTAMP(3) NOT NULL,
    "evaluationEnd" TIMESTAMP(3) NOT NULL,
    "subjectType" "AnalyticsSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "supportingRecords" JSONB NOT NULL,
    "dataQuality" "AnalyticsDataQuality" NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL,
    "status" "AnalyticsIndicatorStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "linkedInvestigationCaseId" TEXT,
    "calculationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "analytics_indicators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_indicator_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "AnalyticsIndicatorStatus",
    "toStatus" "AnalyticsIndicatorStatus",
    "note" TEXT,
    "actorUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_indicator_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_calculation_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "AnalyticsCalculationStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rulesEvaluated" INTEGER NOT NULL DEFAULT 0,
    "indicatorsCreated" INTEGER NOT NULL DEFAULT 0,
    "indicatorsUpdated" INTEGER NOT NULL DEFAULT 0,
    "indicatorsSuppressed" INTEGER NOT NULL DEFAULT 0,
    "dataQuality" "AnalyticsDataQuality" NOT NULL DEFAULT 'COMPLETE',
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    CONSTRAINT "analytics_calculation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analytics_rules_tenantId_code_version_key" ON "analytics_rules"("tenantId", "code", "version");
CREATE INDEX "analytics_rules_tenantId_code_supersededAt_idx" ON "analytics_rules"("tenantId", "code", "supersededAt");

CREATE UNIQUE INDEX "analytics_indicators_calculationKey_key" ON "analytics_indicators"("calculationKey");
CREATE UNIQUE INDEX "analytics_indicators_tenantId_ruleCode_subjectType_subjectId_evaluationStart_evaluationEnd_key"
    ON "analytics_indicators"("tenantId", "ruleCode", "subjectType", "subjectId", "evaluationStart", "evaluationEnd");
CREATE INDEX "analytics_indicators_tenantId_status_severity_lastDetectedAt_idx" ON "analytics_indicators"("tenantId", "status", "severity", "lastDetectedAt");
CREATE INDEX "analytics_indicators_tenantId_subjectType_subjectId_idx" ON "analytics_indicators"("tenantId", "subjectType", "subjectId");
CREATE INDEX "analytics_indicators_tenantId_ruleCode_lastDetectedAt_idx" ON "analytics_indicators"("tenantId", "ruleCode", "lastDetectedAt");

CREATE INDEX "analytics_indicator_events_tenantId_indicatorId_occurredAt_idx" ON "analytics_indicator_events"("tenantId", "indicatorId", "occurredAt");
CREATE INDEX "analytics_calculation_runs_tenantId_startedAt_idx" ON "analytics_calculation_runs"("tenantId", "startedAt");

ALTER TABLE "analytics_rules" ADD CONSTRAINT "analytics_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rules" ADD CONSTRAINT "analytics_rules_configuredByUserId_fkey" FOREIGN KEY ("configuredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analytics_indicators" ADD CONSTRAINT "analytics_indicators_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_indicators" ADD CONSTRAINT "analytics_indicators_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "analytics_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analytics_indicators" ADD CONSTRAINT "analytics_indicators_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "analytics_indicators" ADD CONSTRAINT "analytics_indicators_linkedInvestigationCaseId_fkey" FOREIGN KEY ("linkedInvestigationCaseId") REFERENCES "investigation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "analytics_indicator_events" ADD CONSTRAINT "analytics_indicator_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_indicator_events" ADD CONSTRAINT "analytics_indicator_events_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "analytics_indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_indicator_events" ADD CONSTRAINT "analytics_indicator_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analytics_calculation_runs" ADD CONSTRAINT "analytics_calculation_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
