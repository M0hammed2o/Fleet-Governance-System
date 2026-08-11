import {
  validateRuntimeConfiguration,
  type RuntimeEnvironmentInput,
} from "@/lib/config/runtime-config-core";

export const READINESS_STATUSES = [
  "READY",
  "BLOCKED",
  "NOT_CONFIGURED",
  "MOCK_ONLY",
  "MANUAL_CONFIRMATION_REQUIRED",
] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export interface ReadinessItem {
  id: string;
  category: string;
  label: string;
  status: ReadinessStatus;
  codeReady: boolean;
  message: string;
}

export interface ReadinessDependencies {
  database?: "READY" | "UNAVAILABLE" | "NOT_CHECKED";
}

export interface ProductionReadinessReport {
  generatedAt: string;
  environment: string;
  releaseReady: boolean;
  codeFoundationReady: boolean;
  summary: Record<ReadinessStatus, number>;
  items: ReadinessItem[];
}

function item(
  id: string,
  category: string,
  label: string,
  status: ReadinessStatus,
  codeReady: boolean,
  message: string,
): ReadinessItem {
  return { id, category, label, status, codeReady, message };
}

function configured(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

export function buildProductionReadinessReport(
  input: RuntimeEnvironmentInput,
  dependencies: ReadinessDependencies = {},
  now: Date = new Date(),
): ProductionReadinessReport {
  const validation = validateRuntimeConfiguration(input);
  const config = validation.config;
  const environment = config?.APP_ENV ?? input.APP_ENV ?? "invalid";
  const items: ReadinessItem[] = [];

  items.push(
    item(
      "application.environment",
      "Application configuration",
      "Deployment environment and base URL",
      environment === "production" && validation.valid ? "READY" : "BLOCKED",
      true,
      environment === "production"
        ? validation.valid
          ? "Typed production configuration passed its fail-closed validation."
          : `Configuration has ${validation.issues.length} non-secret validation issue(s).`
        : "APP_ENV is not production; this is not a releasable production configuration.",
    ),
  );

  const databaseStatus = dependencies.database ?? "NOT_CHECKED";
  items.push(
    item(
      "database.connection",
      "Database",
      "Managed PostgreSQL runtime and migration connections",
      !configured(config?.DATABASE_URL)
        ? "NOT_CONFIGURED"
        : databaseStatus === "READY"
          ? "READY"
          : databaseStatus === "UNAVAILABLE"
            ? "BLOCKED"
            : "MANUAL_CONFIRMATION_REQUIRED",
      true,
      databaseStatus === "READY"
        ? "The read-only database probe succeeded; pooled runtime and direct migration URLs remain separately configurable."
        : databaseStatus === "UNAVAILABLE"
          ? "The read-only database probe failed. No connection details are included in this report."
          : "Run the read-only database probe and confirm managed backups, TLS certificate policy, pooling and restore ownership.",
    ),
  );

  const storageProvider = config?.STORAGE_PROVIDER ?? input.STORAGE_PROVIDER;
  items.push(
    item(
      "storage.provider",
      "Storage",
      "Private durable evidence storage",
      storageProvider === "r2"
        ? "MANUAL_CONFIRMATION_REQUIRED"
        : storageProvider === "local"
          ? "MOCK_ONLY"
          : "NOT_CONFIGURED",
      true,
      storageProvider === "r2"
        ? "The existing S3-compatible adapter boundary is configured; bucket privacy, lifecycle, restore, deletion and credential rotation still require operator confirmation."
        : "Local filesystem storage is suitable only for development/test and is fail-closed for APP_ENV=production.",
    ),
  );

  const authReady = configured(config?.SESSION_SECRET) && configured(config?.MEDIA_URL_SIGNING_SECRET);
  items.push(
    item(
      "authentication.secrets",
      "Authentication",
      "Session and signed-media key material",
      authReady ? "READY" : "NOT_CONFIGURED",
      true,
      authReady
        ? "Current keys are configured; previous-key variables support bounded rotation without printing key material."
        : "Strong current secrets are required; values must come from a production secret manager.",
    ),
  );

  items.push(
    item(
      "jobs.scheduler",
      "Scheduled jobs",
      "Authenticated scheduler and operational ownership",
      configured(config?.JOB_SCHEDULER_TOKEN) ? "MANUAL_CONFIRMATION_REQUIRED" : "NOT_CONFIGURED",
      true,
      configured(config?.JOB_SCHEDULER_TOKEN)
        ? "Job authentication and database overlap locks are code-ready; cadence, alert routing and operational owners require approval."
        : "No scheduler token or external scheduler is configured; every job route remains fail-closed.",
    ),
  );

  items.push(
    item(
      "monitoring.provider",
      "Monitoring",
      "Error tracking, logs, metrics, uptime and alert routing",
      config?.MONITORING_PROVIDER === "generic" ? "MANUAL_CONFIRMATION_REQUIRED" : "NOT_CONFIGURED",
      true,
      "Structured/redacted logging foundations are local; a monitoring vendor, retention, alert recipients and incident thresholds require approval.",
    ),
  );

  const emailProvider = config?.BILLING_EMAIL_PROVIDER ?? input.BILLING_EMAIL_PROVIDER;
  items.push(
    item(
      "email.provider",
      "Email",
      "Transactional email delivery",
      emailProvider === "mock" || emailProvider === "dev-console"
        ? "MOCK_ONLY"
        : emailProvider === "transactional"
          ? "BLOCKED"
          : "NOT_CONFIGURED",
      emailProvider !== "transactional",
      emailProvider === "transactional"
        ? "A real adapter cannot be completed until a provider, templates, domain authentication and credentials are approved."
        : "No real email is sent. No-op/mock behavior remains explicit and production-safe.",
    ),
  );

  const paymentProvider = config?.PAYMENT_PROVIDER ?? input.PAYMENT_PROVIDER;
  items.push(
    item(
      "billing.provider",
      "Billing",
      "Subscription payment gateway",
      paymentProvider === "mock"
        ? "MOCK_ONLY"
        : paymentProvider === "payfast"
          ? "BLOCKED"
          : "NOT_CONFIGURED",
      paymentProvider !== "payfast",
      paymentProvider === "payfast"
        ? "The PayFast boundary is named but remains fail-closed until official merchant documentation, webhook rules, sandbox access and credentials are supplied."
        : "No real payment can be initiated; mock success is rejected when APP_ENV=production.",
    ),
  );

  const trackerProvider = config?.TELEMATICS_PROVIDER ?? input.TELEMATICS_PROVIDER;
  items.push(
    item(
      "tracker.provider",
      "Tracker integrations",
      "Tenant-authorised tracker provider",
      trackerProvider === "mock"
        ? "MOCK_ONLY"
        : trackerProvider && trackerProvider !== "disabled"
          ? "BLOCKED"
          : "NOT_CONFIGURED",
      trackerProvider === "disabled" || trackerProvider === "mock" || !trackerProvider,
      trackerProvider && !["disabled", "mock"].includes(trackerProvider)
        ? "Provider-specific work is blocked on official API/webhook documentation, sandbox access, customer authorisation and credentials."
        : "Tracking remains mock/unavailable and analytics continues to label its source honestly.",
    ),
  );

  items.push(
    item(
      "retention.legal",
      "Retention",
      "Retention periods and provider deletion propagation",
      "MANUAL_CONFIRMATION_REQUIRED",
      true,
      "Existing safe defaults and holds remain active; legal owners must approve periods for evidence, analytics, tracker, notification, billing, audit and backup copies.",
    ),
  );

  items.push(
    item(
      "backup.restore",
      "Backup and recovery",
      "Backup policy and restore verification",
      configured(config?.BACKUP_STRATEGY) && configured(config?.BACKUP_LAST_RESTORE_TEST_AT)
        ? "MANUAL_CONFIRMATION_REQUIRED"
        : "NOT_CONFIGURED",
      true,
      "Local safety tooling can verify an isolated restore; production RPO/RTO, encryption, retention and the latest managed restore evidence require operator confirmation.",
    ),
  );

  items.push(
    item(
      "privacy.approvals",
      "Privacy and compliance",
      "POPIA, Information Officer and PAIA approvals",
      config?.INFORMATION_OFFICER_CONFIRMED && config?.PAIA_MANUAL_CONFIRMED
        ? "READY"
        : "MANUAL_CONFIRMATION_REQUIRED",
      true,
      "The business must record Information Officer ownership, PAIA/manual status, data-subject procedures and breach contacts before release.",
    ),
  );

  items.push(
    item(
      "deployment.target",
      "Deployment",
      "Hosting, domains, TLS, runtime and release ownership",
      configured(config?.DEPLOYMENT_TARGET) ? "MANUAL_CONFIRMATION_REQUIRED" : "NOT_CONFIGURED",
      true,
      "No hosting target, DNS change or deployment has been performed; infrastructure approval and a release owner are required.",
    ),
  );

  items.push(
    item(
      "pilot.approval",
      "Pilot information",
      "Pilot scope, support owner and synthetic-to-real data transition",
      config?.PILOT_APPROVED && configured(config.PILOT_SUPPORT_OWNER)
        ? "READY"
        : "MANUAL_CONFIRMATION_REQUIRED",
      true,
      "Pilot tenant, users, sites, operating hours, rule owners, training, support and rollback require explicit business approval.",
    ),
  );

  const summary = Object.fromEntries(
    READINESS_STATUSES.map((status) => [status, items.filter((entry) => entry.status === status).length]),
  ) as Record<ReadinessStatus, number>;

  return {
    generatedAt: now.toISOString(),
    environment,
    releaseReady: items.every((entry) => entry.status === "READY"),
    codeFoundationReady: items.every((entry) => entry.codeReady),
    summary,
    items,
  };
}
