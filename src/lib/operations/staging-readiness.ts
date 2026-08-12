import { validateRuntimeConfiguration, type RuntimeEnvironmentInput } from "@/lib/config/runtime-config-core";

export interface StagingReadinessItem { id: string; status: "READY" | "BLOCKED" | "MANUAL_CONFIRMATION_REQUIRED"; message: string }
export interface StagingReadinessReport { environment: string; ready: boolean; deploying: false; items: StagingReadinessItem[] }

function configured(value: string | undefined): boolean { return Boolean(value?.trim()); }
function item(id: string, ready: boolean, message: string, manual = false): StagingReadinessItem { return { id, status: ready ? "READY" : manual ? "MANUAL_CONFIRMATION_REQUIRED" : "BLOCKED", message }; }

export function buildStagingReadinessReport(input: RuntimeEnvironmentInput): StagingReadinessReport {
  const validation = validateRuntimeConfiguration(input);
  const items: StagingReadinessItem[] = [
    item("configuration", validation.config?.APP_ENV === "staging" && validation.valid, validation.valid ? "Typed staging configuration passed." : `Typed staging configuration has ${validation.issues.length} non-secret issue(s).`),
    item("approved-commit", configured(input.STAGING_APPROVED_COMMIT) && /^[a-f0-9]{7,40}$/i.test(input.STAGING_APPROVED_COMMIT!), "An immutable reviewed commit must be recorded.", true),
    item("release-approval", input.STAGING_RELEASE_APPROVED === "true", "A named release owner must approve staging release.", true),
    item("rollback-owner", configured(input.STAGING_ROLLBACK_OWNER), "A rollback owner and window must be recorded.", true),
    item("synthetic-data", input.STAGING_SYNTHETIC_DATA_CONFIRMED === "true", "Initial staging must contain synthetic data only.", true),
    item("email-isolation", input.STAGING_EXTERNAL_EMAIL_DISABLED === "true", "External email delivery must be disabled or proven to use an approved sink.", true),
    item("payment-isolation", input.STAGING_PAYMENT_DISABLED_OR_SANDBOX === "true", "Billing must be disabled or isolated to an approved sandbox.", true),
    item("tracker-isolation", input.STAGING_TRACKER_SANDBOX_ISOLATED === "true", "Tracking must be synthetic/disabled until a separately approved sandbox passes conformance.", true),
    item("backup-restore", configured(input.BACKUP_STRATEGY) && configured(input.BACKUP_LAST_RESTORE_TEST_AT), "Backup policy and an isolated restore rehearsal require evidence.", true),
    item("monitoring", input.MONITORING_PROVIDER === "generic", "Redacted monitoring and alert routing require an approved target and owner.", true),
  ];
  return { environment: validation.config?.APP_ENV ?? input.APP_ENV ?? "invalid", ready: items.every((entry) => entry.status === "READY"), deploying: false, items };
}
