import { describe, expect, it } from "vitest";
import { validateRuntimeConfiguration, type RuntimeEnvironmentInput } from "@/lib/config/runtime-config-core";
import { buildStagingReadinessReport } from "@/lib/operations/staging-readiness";

function staging(overrides: RuntimeEnvironmentInput = {}): RuntimeEnvironmentInput {
  return { APP_ENV: "staging", APP_BASE_URL: "https://staging.fleet.example.org", DATABASE_URL: "postgresql://runtime:strong@pool.db.internal/genbridge_staging", DIRECT_DATABASE_URL: "postgresql://migration:strong@direct.db.internal/genbridge_staging", DATABASE_SSL_MODE: "verify-full", SESSION_SECRET: "s".repeat(48), MEDIA_URL_SIGNING_SECRET: "m".repeat(48), BIOMETRIC_TEMPLATE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), JOB_SCHEDULER_TOKEN: "j".repeat(48), STORAGE_PROVIDER: "r2", R2_ACCOUNT_ID: "account", R2_ACCESS_KEY_ID: "access", R2_SECRET_ACCESS_KEY: "private-storage-value", R2_BUCKET_NAME: "synthetic-staging-evidence", PAYMENT_PROVIDER: "noop", BILLING_EMAIL_PROVIDER: "noop", INVESTIGATION_NOTIFICATION_PROVIDER: "noop", AUDITOR_INVITATION_PROVIDER: "noop", RETENTION_NOTIFICATION_PROVIDER: "noop", TELEMATICS_PROVIDER: "synthetic", MONITORING_PROVIDER: "generic", ...overrides };
}

describe("fail-closed staging configuration", () => {
  it("accepts a technically isolated synthetic staging configuration", () => {
    expect(validateRuntimeConfiguration(staging())).toMatchObject({ valid: true, issues: [] });
  });

  it("rejects local URLs, development databases, local storage and external providers", () => {
    const result = validateRuntimeConfiguration(staging({ APP_BASE_URL: "http://localhost:3000", DATABASE_URL: "postgresql://u:p@localhost/app_dev", DIRECT_DATABASE_URL: "postgresql://u:p@localhost/app_dev", STORAGE_PROVIDER: "local", PAYMENT_PROVIDER: "payfast", BILLING_EMAIL_PROVIDER: "transactional", TELEMATICS_PROVIDER: "custom" }));
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.variable)).toEqual(expect.arrayContaining(["APP_BASE_URL", "DATABASE_URL", "DIRECT_DATABASE_URL", "STORAGE_PROVIDER", "PAYMENT_PROVIDER", "BILLING_EMAIL_PROVIDER", "TELEMATICS_PROVIDER"]));
  });

  it("rejects placeholder secrets and production synthetic tracking", () => {
    expect(validateRuntimeConfiguration(staging({ SESSION_SECRET: "change-me-placeholder-secret-value" })).valid).toBe(false);
    const production = validateRuntimeConfiguration({ ...staging(), APP_ENV: "production", TELEMATICS_PROVIDER: "synthetic", DATABASE_URL: "postgresql://runtime:strong@pool.db.internal/genbridge", DIRECT_DATABASE_URL: "postgresql://migration:strong@direct.db.internal/genbridge" });
    expect(production.issues).toContainEqual(expect.objectContaining({ variable: "TELEMATICS_PROVIDER" }));
  });

  it("keeps manual approvals fail-closed even when technical configuration is valid", () => {
    const report = buildStagingReadinessReport(staging());
    expect(report.ready).toBe(false);
    expect(report.deploying).toBe(false);
    expect(report.items.find((entry) => entry.id === "release-approval")?.status).toBe("MANUAL_CONFIRMATION_REQUIRED");
    expect(JSON.stringify(report)).not.toContain("private-storage-value");
  });
});
