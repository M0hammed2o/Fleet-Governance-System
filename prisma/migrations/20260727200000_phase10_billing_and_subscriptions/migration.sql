-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceLineItemKind" AS ENUM ('BASE_FEE', 'VEHICLE_FEE', 'ARCHIVE_STORAGE', 'ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingPeriodStatus" AS ENUM ('PENDING', 'SNAPSHOTTED', 'INVOICED');

-- CreateEnum
CREATE TYPE "BillingEmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingEmailTriggerEvent" AS ENUM ('PAYMENT_SUCCESS', 'MANUAL_APPROVAL', 'RESEND');

-- CreateEnum
CREATE TYPE "PaymentProviderEventResult" AS ENUM ('ACCEPTED', 'REJECTED_INVALID_SIGNATURE', 'REJECTED_AMOUNT_MISMATCH', 'REJECTED_CURRENCY_MISMATCH', 'DUPLICATE', 'ERROR');

-- AlterEnum
ALTER TYPE "MediaAssetOwnerType" ADD VALUE 'INVOICE';

-- DropForeignKey
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_capturedByUserId_fkey";

-- AlterTable
ALTER TABLE "media_assets" ALTER COLUMN "capturedByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_pricing_versions" (
    "id" TEXT NOT NULL,
    "baseFeeMinorUnits" INTEGER NOT NULL,
    "perVehicleFeeMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_pricing_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_settings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "legalName" TEXT NOT NULL DEFAULT '',
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "vatRegistrationNumber" TEXT,
    "vatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vatRateBasisPoints" INTEGER,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'South Africa',
    "billingEmail" TEXT,
    "telephone" TEXT,
    "bankingInstructions" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "nextInvoiceSequence" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "defaultGracePeriodDays" INTEGER NOT NULL DEFAULT 14,
    "defaultBaseFeeMinorUnits" INTEGER NOT NULL DEFAULT 199900,
    "defaultPerVehicleFeeMinorUnits" INTEGER NOT NULL DEFAULT 29900,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_billing_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registeredBusinessName" TEXT,
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "vatNumber" TEXT,
    "billingAddressLine1" TEXT,
    "billingAddressLine2" TEXT,
    "billingCity" TEXT,
    "billingPostalCode" TEXT,
    "billingCountry" TEXT NOT NULL DEFAULT 'South Africa',
    "billingEmail" TEXT,
    "accountsContactName" TEXT,
    "accountsContactEmail" TEXT,
    "accountsContactPhone" TEXT,
    "poRequired" BOOLEAN NOT NULL DEFAULT false,
    "customerReference" TEXT,
    "paymentTermsDays" INTEGER,
    "gracePeriodDays" INTEGER,
    "subscriptionStartDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_billing_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_billing_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_pricing_agreements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "baseFeeMinorUnits" INTEGER NOT NULL,
    "perVehicleFeeMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pricing_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "suspendedByUserId" TEXT,
    "restoredAt" TIMESTAMP(3),
    "restoredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_periods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "BillingPeriodStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billable_vehicle_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billingPeriodId" TEXT NOT NULL,
    "vehicleIds" TEXT[],
    "vehicleCount" INTEGER NOT NULL,
    "baseFeeMinorUnitsApplied" INTEGER NOT NULL,
    "perVehicleFeeMinorUnitsApplied" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByUserId" TEXT,

    CONSTRAINT "billable_vehicle_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billingPeriodId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "subtotalMinorUnits" INTEGER NOT NULL,
    "vatRateBasisPoints" INTEGER,
    "vatAmountMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "totalMinorUnits" INTEGER NOT NULL,
    "supplierSnapshot" JSONB NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "customerPoReference" TEXT,
    "paymentReference" TEXT,
    "pdfMediaAssetId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "reissueOfInvoiceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "InvoiceLineItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinorUnits" INTEGER NOT NULL,
    "lineTotalMinorUnits" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL,
    "providerName" TEXT,
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recordedByUserId" TEXT,
    "manualProofReference" TEXT,
    "manualNote" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "resolvedPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "tenantId" TEXT,
    "invoiceId" TEXT,
    "payload" JSONB NOT NULL,
    "processingResult" "PaymentProviderEventResult",
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_email_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "relatedPaymentId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "status" "BillingEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "triggerEvent" "BillingEmailTriggerEvent" NOT NULL,
    "triggeredByUserId" TEXT,
    "provider" TEXT NOT NULL,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_adjustments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_name_key" ON "subscription_plans"("name");

-- CreateIndex
CREATE INDEX "platform_pricing_versions_effectiveFrom_idx" ON "platform_pricing_versions"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_billing_profiles_tenantId_key" ON "tenant_billing_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "customer_billing_contacts_tenantId_idx" ON "customer_billing_contacts"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_pricing_agreements_tenantId_effectiveFrom_idx" ON "tenant_pricing_agreements"("tenantId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_tenantId_key" ON "tenant_subscriptions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_periods_tenantId_periodStart_key" ON "billing_periods"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "billable_vehicle_snapshots_billingPeriodId_key" ON "billable_vehicle_snapshots"("billingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_billingPeriodId_key" ON "invoices"("billingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_pdfMediaAssetId_key" ON "invoices"("pdfMediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_reissueOfInvoiceId_key" ON "invoices"("reissueOfInvoiceId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_tenantId_invoiceId_idx" ON "payments"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_idempotencyKey_key" ON "payment_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_attempts_tenantId_invoiceId_idx" ON "payment_attempts"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_provider_externalEventId_key" ON "payment_provider_events"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "billing_email_deliveries_tenantId_invoiceId_idx" ON "billing_email_deliveries"("tenantId", "invoiceId");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_pricing_versions" ADD CONSTRAINT "platform_pricing_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_billing_settings" ADD CONSTRAINT "platform_billing_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_billing_profiles" ADD CONSTRAINT "tenant_billing_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_billing_contacts" ADD CONSTRAINT "customer_billing_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_pricing_agreements" ADD CONSTRAINT "tenant_pricing_agreements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_pricing_agreements" ADD CONSTRAINT "tenant_pricing_agreements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_suspendedByUserId_fkey" FOREIGN KEY ("suspendedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_restoredByUserId_fkey" FOREIGN KEY ("restoredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_vehicle_snapshots" ADD CONSTRAINT "billable_vehicle_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_vehicle_snapshots" ADD CONSTRAINT "billable_vehicle_snapshots_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_vehicle_snapshots" ADD CONSTRAINT "billable_vehicle_snapshots_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pdfMediaAssetId_fkey" FOREIGN KEY ("pdfMediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reissueOfInvoiceId_fkey" FOREIGN KEY ("reissueOfInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_email_deliveries" ADD CONSTRAINT "billing_email_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_email_deliveries" ADD CONSTRAINT "billing_email_deliveries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_email_deliveries" ADD CONSTRAINT "billing_email_deliveries_relatedPaymentId_fkey" FOREIGN KEY ("relatedPaymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_email_deliveries" ADD CONSTRAINT "billing_email_deliveries_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_adjustments" ADD CONSTRAINT "credit_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_adjustments" ADD CONSTRAINT "credit_adjustments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_adjustments" ADD CONSTRAINT "credit_adjustments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 10 (P10G/P10H) — hand-authored partial unique index (Prisma's
-- @@unique has no WHERE clause, same pattern as job_runs_one_running_per_job_name
-- and driver_facial_templates_one_active_per_driver): at most one
-- PAYMENT_SUCCESS-or-MANUAL_APPROVAL billing-email delivery per
-- (invoiceId, relatedPaymentId) — a duplicate webhook or duplicate manual
-- approval for the same payment event can never queue the invoice email
-- twice. A RESEND is a deliberate new row every time and is excluded.
CREATE UNIQUE INDEX "billing_email_deliveries_one_per_invoice_payment_event" ON "billing_email_deliveries"("invoiceId", "relatedPaymentId") WHERE "triggerEvent" IN ('PAYMENT_SUCCESS', 'MANUAL_APPROVAL');
