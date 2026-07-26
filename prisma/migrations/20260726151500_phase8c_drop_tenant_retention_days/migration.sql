-- Phase 8C: replaces the single tenant-wide retention assumption with
-- per-category RetentionPolicy rows (see the previous migration). This
-- column was never read or written by any application code (confirmed via
-- codebase search before dropping) — only ever the schema default.
ALTER TABLE "tenants" DROP COLUMN "retentionDays";
