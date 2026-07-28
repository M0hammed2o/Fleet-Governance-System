-- CreateEnum
CREATE TYPE "InvestigationNotificationEventType" AS ENUM ('ASSIGNMENT', 'INFORMATION_REQUESTED', 'OVERDUE_TASK', 'ESCALATION', 'APPROVAL_REQUIRED', 'APPROVAL_RETURNED', 'APPROVAL_REJECTED', 'CLOSURE', 'EXTERNAL_ACCESS_GRANTED', 'EXTERNAL_ACCESS_EXPIRING', 'EXTERNAL_ACCESS_REVOKED');

-- CreateEnum
CREATE TYPE "InvestigationNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "investigation_notification_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" "InvestigationNotificationEventType" NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "status" "InvestigationNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_notification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investigation_notification_records_tenantId_caseId_idx" ON "investigation_notification_records"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "investigation_notification_records_tenantId_status_idx" ON "investigation_notification_records"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "investigation_notification_records" ADD CONSTRAINT "investigation_notification_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notification_records" ADD CONSTRAINT "investigation_notification_records_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "investigation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notification_records" ADD CONSTRAINT "investigation_notification_records_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
