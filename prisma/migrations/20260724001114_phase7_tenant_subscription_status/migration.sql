-- CreateEnum
CREATE TYPE "TenantSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "subscriptionStatus" "TenantSubscriptionStatus" NOT NULL DEFAULT 'TRIAL';
