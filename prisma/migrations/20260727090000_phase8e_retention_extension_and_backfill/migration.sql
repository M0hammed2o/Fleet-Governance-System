-- Phase 8E-001: automatic retention assignment + backfill.

-- AlterTable: marker for an explicit, human-initiated retention extension
-- (extendRetention() in retention-repository.ts). NULL means "never
-- explicitly extended" — either not yet computed, or a plain policy-derived
-- value that automatic (re)assignment is free to recalculate.
ALTER TABLE "media_assets" ADD COLUMN "retentionExtendedAt" TIMESTAMP(3);

-- Backfill: every existing ACTIVE MediaAsset uploaded before automatic
-- retention assignment existed has a null scheduledDeletionAt. Compute it
-- now from capturedAt + the tenant's effective per-category RetentionPolicy,
-- falling back to the same 365-day default the application uses when no
-- RetentionPolicy row exists for that (tenant, category) pair (see
-- getEffectiveRetentionPolicy() in retention-policy-repository.ts).
--
-- Excluded by the WHERE clause below, per Phase 8E-001's explicit scope:
--   - retentionStatus <> 'ACTIVE'   (already-archived, pending-deletion, or
--                                    permanently-deleted metadata records)
--   - legalHold / investigationHold (evidence under a hold — policy requires
--                                    restriction; left null rather than
--                                    guessing a deletion date for it)
--   - retentionExtendedAt IS NOT NULL (impossible for any pre-existing row
--                                    immediately after the ADD COLUMN above,
--                                    but included so this statement stays
--                                    correct and safely re-runnable if ever
--                                    copied into a later data-fix)
--
-- Forward-only and idempotent: only touches rows where scheduledDeletionAt
-- IS NULL, so re-applying this UPDATE a second time against an
-- already-backfilled database is a no-op.
UPDATE "media_assets" ma
SET "scheduledDeletionAt" = ma."capturedAt" + (
  COALESCE(
    (SELECT rp."retentionDays" FROM "retention_policies" rp WHERE rp."tenantId" = ma."tenantId" AND rp."category" = ma."category"),
    365
  ) || ' days'
)::interval
WHERE ma."retentionStatus" = 'ACTIVE'
  AND ma."scheduledDeletionAt" IS NULL
  AND ma."legalHold" = false
  AND ma."investigationHold" = false
  AND ma."retentionExtendedAt" IS NULL;
