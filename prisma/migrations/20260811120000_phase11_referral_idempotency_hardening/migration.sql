-- Make operational-record referral idempotency safe under concurrent requests.
ALTER TABLE "investigation_cases" ADD COLUMN "activeReferralKey" TEXT;

CREATE UNIQUE INDEX "investigation_cases_activeReferralKey_key"
ON "investigation_cases"("activeReferralKey");
