-- Legacy rows do not have a trustworthy actor. Every mapping created through
-- the Phase 15 repository still requires and records an authorised user.
ALTER TABLE "tracker_vehicle_mappings" ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- IDs are globally unique; these composite keys additionally support
-- database-enforced tenant matching for mapping relations.
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_tenantId_id_key" ON "vehicles"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_id_key" ON "users"("tenantId", "id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_vehicle_mappings_tenant_vehicle_fkey') THEN
    ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_tenant_vehicle_fkey" FOREIGN KEY ("tenantId", "vehicleId") REFERENCES "vehicles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_vehicle_mappings_tenant_created_by_fkey') THEN
    ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_tenant_created_by_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_vehicle_mappings_tenant_ended_by_fkey') THEN
    ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_vehicle_mappings_tenant_ended_by_fkey" FOREIGN KEY ("tenantId", "endedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Friendly repository conflicts run first; these indexes close concurrency
-- races while retaining all effective-dated history.
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_mapping_active_vehicle_key" ON "tracker_vehicle_mappings"("tenantId", "vehicleId") WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_mapping_active_asset_key" ON "tracker_vehicle_mappings"("tenantId", "providerId", "providerAssetId") WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "telematics_events_tenantId_providerId_providerEventId_key" ON "telematics_events"("tenantId", "providerId", "providerEventId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_mapping_effective_window_check') THEN
    ALTER TABLE "tracker_vehicle_mappings" ADD CONSTRAINT "tracker_mapping_effective_window_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
  END IF;
END $$;

-- Preserve only unambiguous mutable legacy mappings. Duplicate provider/device
-- references are deliberately left unmapped for quarantine and human review.
INSERT INTO "tracker_vehicle_mappings" (
  "id", "tenantId", "vehicleId", "providerId", "providerAssetId", "source",
  "effectiveFrom", "reason", "createdByUserId", "createdAt"
)
SELECT
  'phase15a-legacy-' || v."id", v."tenantId", v."id",
  COALESCE(NULLIF(TRIM(v."gpsProvider"), ''), 'legacy-unclassified'),
  v."gpsDeviceReference",
  CASE WHEN LOWER(COALESCE(v."gpsProvider", '')) IN ('mock', 'synthetic') THEN 'SYNTHETIC'::"TrackerMappingSource" ELSE 'LIVE_PROVIDER'::"TrackerMappingSource" END,
  v."createdAt", 'Imported from unambiguous legacy vehicle mapping fields; actor unavailable.', NULL, CURRENT_TIMESTAMP
FROM "vehicles" v
WHERE v."gpsDeviceReference" IS NOT NULL
  AND TRIM(v."gpsDeviceReference") <> ''
  AND NOT EXISTS (SELECT 1 FROM "tracker_vehicle_mappings" existing WHERE existing."tenantId" = v."tenantId" AND existing."vehicleId" = v."id" AND existing."effectiveTo" IS NULL)
  AND 1 = (
    SELECT COUNT(*) FROM "vehicles" candidate
    WHERE candidate."tenantId" = v."tenantId"
      AND COALESCE(NULLIF(TRIM(candidate."gpsProvider"), ''), 'legacy-unclassified') = COALESCE(NULLIF(TRIM(v."gpsProvider"), ''), 'legacy-unclassified')
      AND candidate."gpsDeviceReference" = v."gpsDeviceReference"
  );

UPDATE "telematics_events"
SET "confidenceLimitations" = 'Legacy event predates Phase 15A provenance fields; source detail was not reconstructed.'
WHERE "confidenceLimitations" IS NULL;
