-- Phase 16A: native-client idempotency and per-user notification state.
-- No mobile session token, evidence body, notification body or personal data is copied.

CREATE TYPE "MobileMutationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "mobile_mutation_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "MobileMutationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "mobile_mutation_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mobile_mutation_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mobile_mutation_receipts_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mobile_mutation_receipts_tenantId_userId_idempotencyKey_key" ON "mobile_mutation_receipts"("tenantId", "userId", "idempotencyKey");
CREATE INDEX "mobile_mutation_receipts_tenantId_createdAt_idx" ON "mobile_mutation_receipts"("tenantId", "createdAt");

CREATE TABLE "mobile_notification_states" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mobile_notification_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mobile_notification_states_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mobile_notification_states_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mobile_notification_states_tenantId_userId_notificationKey_key" ON "mobile_notification_states"("tenantId", "userId", "notificationKey");
CREATE INDEX "mobile_notification_states_tenantId_userId_readAt_idx" ON "mobile_notification_states"("tenantId", "userId", "readAt");
