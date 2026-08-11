-- DropForeignKey
ALTER TABLE "analytics_rules" DROP CONSTRAINT "analytics_rules_configuredByUserId_fkey";

-- DropIndex
DROP INDEX "investigation_notification_records_tenantId_status_idx";

-- DropIndex
DROP INDEX "retention_notification_records_status_idx";

-- AlterTable
ALTER TABLE "investigation_notification_records" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "retention_notification_records" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "authentication_attempts" (
    "id" TEXT NOT NULL,
    "identifierHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "authentication_attempts_identifierHash_succeeded_attemptedA_idx" ON "authentication_attempts"("identifierHash", "succeeded", "attemptedAt");

-- CreateIndex
CREATE INDEX "authentication_attempts_ipHash_succeeded_attemptedAt_idx" ON "authentication_attempts"("ipHash", "succeeded", "attemptedAt");

-- CreateIndex
CREATE INDEX "authentication_attempts_attemptedAt_idx" ON "authentication_attempts"("attemptedAt");

-- CreateIndex
CREATE INDEX "investigation_notification_records_tenantId_status_nextAtte_idx" ON "investigation_notification_records"("tenantId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "retention_notification_records_status_nextAttemptAt_idx" ON "retention_notification_records"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "analytics_rules" ADD CONSTRAINT "analytics_rules_configuredByUserId_fkey" FOREIGN KEY ("configuredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "analytics_indicators_tenantId_ruleCode_subjectType_subjectId_ev" RENAME TO "analytics_indicators_tenantId_ruleCode_subjectType_subjectI_key";

-- RenameIndex
ALTER INDEX "analytics_indicators_tenantId_status_severity_lastDetectedAt_id" RENAME TO "analytics_indicators_tenantId_status_severity_lastDetectedA_idx";
