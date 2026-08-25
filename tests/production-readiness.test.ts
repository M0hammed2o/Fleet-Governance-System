import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIVATE_ENVIRONMENT_VARIABLES,
  validateRuntimeConfiguration,
  type RuntimeEnvironmentInput,
} from "@/lib/config/runtime-config-core";
import { buildProductionReadinessReport } from "@/lib/operations/readiness-core";
import { redactForLogging } from "@/lib/observability/logger";
import { evaluateRequestPolicy } from "@/lib/security/request-policy";
import { signResourceAccess, verifyResourceAccess } from "@/lib/storage/signed-url";
import { authorizeJobRequest } from "@/lib/jobs/service-auth";
import { GET as getLiveness } from "@/app/api/health/live/route";
import { GET as getReadiness } from "@/app/api/health/ready/route";
import { GET as getVersion } from "@/app/api/health/version/route";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

function productionEnvironment(overrides: RuntimeEnvironmentInput = {}): RuntimeEnvironmentInput {
  return {
    APP_ENV: "production",
    APP_BASE_URL: "https://fleet.example.org",
    DATABASE_URL: "postgresql://runtime:strong@pool.db.internal/genbridge",
    DIRECT_DATABASE_URL: "postgresql://migration:strong@direct.db.internal/genbridge",
    DATABASE_SSL_MODE: "verify-full",
    SESSION_SECRET: "s".repeat(48),
    MEDIA_URL_SIGNING_SECRET: "m".repeat(48),
    BIOMETRIC_TEMPLATE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    JOB_SCHEDULER_TOKEN: "j".repeat(48),
    STORAGE_PROVIDER: "r2",
    R2_ACCOUNT_ID: "account-id",
    R2_ACCESS_KEY_ID: "access-id",
    R2_SECRET_ACCESS_KEY: "storage-secret-value",
    R2_BUCKET_NAME: "private-evidence",
    PAYMENT_PROVIDER: "noop",
    BILLING_EMAIL_PROVIDER: "noop",
    INVESTIGATION_NOTIFICATION_PROVIDER: "noop",
    AUDITOR_INVITATION_PROVIDER: "noop",
    RETENTION_NOTIFICATION_PROVIDER: "noop",
    TELEMATICS_PROVIDER: "disabled",
    MONITORING_PROVIDER: "disabled",
    ...overrides,
  };
}

describe("Phase 13A production configuration", () => {
  it("accepts a strongly configured provider-neutral production runtime", () => {
    const result = validateRuntimeConfiguration(productionEnvironment());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.config?.DATABASE_MAX_CONNECTIONS).toBe(10);
  });

  it("reports every required production variable without printing a value", () => {
    const result = validateRuntimeConfiguration({ APP_ENV: "production" });
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.variable)).toEqual(expect.arrayContaining([
      "APP_BASE_URL",
      "DATABASE_URL",
      "DIRECT_DATABASE_URL",
      "SESSION_SECRET",
      "MEDIA_URL_SIGNING_SECRET",
      "BIOMETRIC_TEMPLATE_ENCRYPTION_KEY",
      "JOB_SCHEDULER_TOKEN",
      "STORAGE_PROVIDER",
    ]));
    expect(JSON.stringify(result.issues)).not.toContain("postgresql://");
  });

  it("rejects invalid/non-HTTPS/local production URLs and unsafe database names", () => {
    const result = validateRuntimeConfiguration(productionEnvironment({
      APP_BASE_URL: "http://localhost:3000",
      DATABASE_URL: "postgresql://user:pass@localhost/app_test",
      DIRECT_DATABASE_URL: "not-a-url",
    }));
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.variable)).toEqual(expect.arrayContaining([
      "APP_BASE_URL",
      "DATABASE_URL",
      "DIRECT_DATABASE_URL",
    ]));
  });

  it("rejects unknown provider identifiers and out-of-range connection values", () => {
    const result = validateRuntimeConfiguration(productionEnvironment({
      STORAGE_PROVIDER: "mystery",
      DATABASE_MAX_CONNECTIONS: "5000",
    }));
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.variable)).toEqual(expect.arrayContaining([
      "STORAGE_PROVIDER",
      "DATABASE_MAX_CONNECTIONS",
    ]));
  });

  it("rejects placeholder secrets and every production mock/dev-console provider", () => {
    const result = validateRuntimeConfiguration(productionEnvironment({
      SESSION_SECRET: "dev-only-change-me-placeholder-secret",
      MEDIA_URL_SIGNING_SECRET: "example-secret-change-me-value-123456",
      PAYMENT_PROVIDER: "mock",
      BILLING_EMAIL_PROVIDER: "mock",
      INVESTIGATION_NOTIFICATION_PROVIDER: "dev-console",
      AUDITOR_INVITATION_PROVIDER: "mock",
      RETENTION_NOTIFICATION_PROVIDER: "dev-console",
      TELEMATICS_PROVIDER: "mock",
    }));
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.variable)).toEqual(expect.arrayContaining([
      "SESSION_SECRET",
      "MEDIA_URL_SIGNING_SECRET",
      "PAYMENT_PROVIDER",
      "BILLING_EMAIL_PROVIDER",
      "INVESTIGATION_NOTIFICATION_PROVIDER",
      "AUDITOR_INVITATION_PROVIDER",
      "RETENTION_NOTIFICATION_PROVIDER",
      "TELEMATICS_PROVIDER",
    ]));
  });

  it("prevents test environments from targeting non-test databases or live providers", () => {
    const result = validateRuntimeConfiguration({
      APP_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@production.db/customer",
      STORAGE_PROVIDER: "r2",
      PAYMENT_PROVIDER: "payfast",
      BILLING_EMAIL_PROVIDER: "transactional",
      TELEMATICS_PROVIDER: "cartrack",
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.variable)).toEqual(expect.arrayContaining([
      "DATABASE_URL",
      "STORAGE_PROVIDER",
      "PAYMENT_PROVIDER",
      "BILLING_EMAIL_PROVIDER",
      "TELEMATICS_PROVIDER",
    ]));
  });

  it("keeps the process.env accessor server-only and defines no public secret name", () => {
    const accessor = fs.readFileSync(path.join(process.cwd(), "src/lib/config/runtime-config.ts"), "utf8");
    expect(accessor).toContain('import "server-only"');
    expect(accessor).toContain("process.env");
    expect(PRIVATE_ENVIRONMENT_VARIABLES.every((name) => !name.startsWith("NEXT_PUBLIC_"))).toBe(true);
    expect(accessor).not.toContain("NEXT_PUBLIC_");
  });
});

describe("Phase 13A readiness classification", () => {
  it("distinguishes code-ready foundations from provider/business blockers", () => {
    const report = buildProductionReadinessReport(productionEnvironment({
      PAYMENT_PROVIDER: "payfast",
      BILLING_EMAIL_PROVIDER: "transactional",
      TELEMATICS_PROVIDER: "cartrack",
    }), { database: "READY" }, new Date("2026-08-11T20:00:00.000Z"));
    expect(report.releaseReady).toBe(false);
    expect(report.items.find((entry) => entry.id === "database.connection")?.status).toBe("READY");
    expect(report.items.find((entry) => entry.id === "billing.provider")?.status).toBe("BLOCKED");
    expect(report.items.find((entry) => entry.id === "email.provider")?.status).toBe("BLOCKED");
    expect(report.items.find((entry) => entry.id === "tracker.provider")?.status).toBe("BLOCKED");
    expect(report.items.find((entry) => entry.id === "retention.legal")?.status).toBe("MANUAL_CONFIRMATION_REQUIRED");
  });

  it("marks an unavailable database as blocked without exposing connection details", () => {
    const report = buildProductionReadinessReport(productionEnvironment(), { database: "UNAVAILABLE" });
    const database = report.items.find((entry) => entry.id === "database.connection");
    expect(database?.status).toBe("BLOCKED");
    expect(database?.message).not.toMatch(/postgresql:|runtime:strong|db\.internal/);
  });

  it("classifies the existing local setup as mock/not configured and never leaks supplied secrets", () => {
    const sentinel = "SENTINEL-NEVER-PRINT";
    const report = buildProductionReadinessReport({
      APP_ENV: "development",
      DATABASE_URL: "postgresql://user:password@localhost/dev",
      SESSION_SECRET: sentinel,
      STORAGE_PROVIDER: "local",
      PAYMENT_PROVIDER: "mock",
      BILLING_EMAIL_PROVIDER: "mock",
      TELEMATICS_PROVIDER: "mock",
    });
    expect(report.releaseReady).toBe(false);
    expect(report.items.find((entry) => entry.id === "storage.provider")?.status).toBe("MOCK_ONLY");
    expect(report.items.find((entry) => entry.id === "billing.provider")?.status).toBe("MOCK_ONLY");
    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(JSON.stringify(report)).not.toContain("password@localhost");
  });
});

describe("Phase 13A request and log security", () => {
  it("redacts secrets, bearer tokens, URL credentials, email and binary data", () => {
    const redacted = redactForLogging({
      password: "super-secret",
      authorization: "Bearer abc.def.ghi",
      database: "postgresql://user:pass@db.internal/app",
      recipient: "person@example.org",
      nested: { biometricTemplate: Buffer.from("private"), safeCount: 4 },
    });
    const encoded = JSON.stringify(redacted);
    expect(encoded).not.toContain("super-secret");
    expect(encoded).not.toContain("abc.def.ghi");
    expect(encoded).not.toContain("user:pass");
    expect(encoded).not.toContain("person@example.org");
    expect(encoded).not.toContain("private");
    expect(encoded).toContain("safeCount");
  });

  it("allows same-origin mutation and rejects cross-site or untrusted origins", () => {
    const base = {
      method: "POST",
      pathname: "/api/vehicles",
      requestOrigin: "https://fleet.example.org",
      configuredOrigins: [] as string[],
    };
    expect(evaluateRequestPolicy({ ...base, origin: "https://fleet.example.org", secFetchSite: "same-origin" }).allowed).toBe(true);
    expect(evaluateRequestPolicy({ ...base, origin: "https://evil.example", secFetchSite: "cross-site" }).allowed).toBe(false);
    expect(evaluateRequestPolicy({ ...base, origin: "https://evil.example", secFetchSite: null }).allowed).toBe(false);
  });

  it("keeps verified payment webhooks and authenticated job routes exempt from browser CSRF origin checks", () => {
    for (const pathname of ["/api/billing/webhook", "/api/jobs/analytics/calculate-indicators"]) {
      expect(evaluateRequestPolicy({
        method: "POST",
        pathname,
        origin: null,
        requestOrigin: "https://fleet.example.org",
        secFetchSite: null,
        configuredOrigins: [],
      }).allowed).toBe(true);
    }
  });

  it("accepts the previous scheduler token during rotation and rejects another token", async () => {
    process.env.JOB_SCHEDULER_TOKEN = "current-token";
    process.env.JOB_SCHEDULER_TOKEN_PREVIOUS = "previous-token";
    await expect(authorizeJobRequest(new Request("http://localhost/api/jobs/x", { headers: { "x-job-scheduler-token": "previous-token" } }))).resolves.toBeUndefined();
    await expect(authorizeJobRequest(new Request("http://localhost/api/jobs/x", { headers: { "x-job-scheduler-token": "wrong-token" } }))).rejects.toThrow(/invalid/i);
  });

  it("accepts current and previous signed-media keys during rotation", () => {
    process.env.MEDIA_URL_SIGNING_SECRET = "current-signing-key";
    process.env.MEDIA_URL_SIGNING_SECRET_PREVIOUS = "previous-signing-key";
    const previous = signResourceAccess("tenant/evidence", 300, "read", "previous-signing-key", new Date("2026-08-11T20:00:00Z"));
    const current = signResourceAccess("tenant/evidence", 300, "read", "current-signing-key", new Date("2026-08-11T20:00:00Z"));
    const now = new Date("2026-08-11T20:01:00Z");
    expect(verifyResourceAccess("tenant/evidence", previous.expiresAt, previous.signature, "read", undefined, now)).toEqual({ valid: true });
    expect(verifyResourceAccess("tenant/evidence", current.expiresAt, current.signature, "read", undefined, now)).toEqual({ valid: true });
  });
});

describe("Phase 13A public health endpoints", () => {
  it("returns a minimal liveness response without internal details", async () => {
    const response = getLiveness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns only safe dependency names and states from readiness", async () => {
    const response = await getReadiness();
    expect([200, 503]).toContain(response.status);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["status", "checks"]);
    expect(Object.keys(body.checks)).toEqual(["database", "configuration"]);
    expect(JSON.stringify(body)).not.toMatch(/postgresql:|localhost|secret|tenant/i);
  });

  it("exposes only a validated deployment commit", async () => {
    process.env.RENDER_GIT_COMMIT = "A".repeat(40);
    const response = getVersion();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commit: "a".repeat(40) });

    process.env.RENDER_GIT_COMMIT = "unsafe-runtime-details";
    expect(await getVersion().json()).toEqual({ commit: null });
  });
});
