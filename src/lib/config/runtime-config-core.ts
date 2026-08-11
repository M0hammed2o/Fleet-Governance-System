import { z } from "zod";

export const DEPLOYMENT_ENVIRONMENTS = ["development", "test", "production"] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export const STORAGE_PROVIDERS = ["local", "r2"] as const;
export const PAYMENT_PROVIDERS = ["noop", "mock", "payfast"] as const;
export const EMAIL_PROVIDERS = ["noop", "mock", "dev-console", "transactional"] as const;
export const TRACKER_PROVIDERS = [
  "disabled",
  "mock",
  "cartrack",
  "netstar",
  "tracker",
  "ctrack",
  "mix-powerfleet",
  "custom",
] as const;
export const MONITORING_PROVIDERS = ["disabled", "generic"] as const;

export const PRIVATE_ENVIRONMENT_VARIABLES = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "SESSION_SECRET",
  "SESSION_SECRET_PREVIOUS",
  "MEDIA_URL_SIGNING_SECRET",
  "MEDIA_URL_SIGNING_SECRET_PREVIOUS",
  "BIOMETRIC_TEMPLATE_ENCRYPTION_KEY",
  "JOB_SCHEDULER_TOKEN",
  "JOB_SCHEDULER_TOKEN_PREVIOUS",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

export type RuntimeEnvironmentInput = Record<string, string | undefined>;

export interface ConfigurationIssue {
  variable: string;
  message: string;
}

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const boundedInteger = (fallback: number, minimum: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    z.coerce.number().int().min(minimum).max(maximum),
  );

const booleanValue = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return value;
  }, z.boolean());

const schema = z.object({
  APP_ENV: z.enum(DEPLOYMENT_ENVIRONMENTS),
  APP_BASE_URL: optionalString,
  DATABASE_URL: optionalString,
  DIRECT_DATABASE_URL: optionalString,
  DATABASE_SSL_MODE: z.enum(["disable", "prefer", "require", "verify-full"]).default("prefer"),
  DATABASE_MAX_CONNECTIONS: boundedInteger(10, 1, 50),
  DATABASE_CONNECTION_TIMEOUT_MS: boundedInteger(5_000, 500, 30_000),
  DATABASE_QUERY_TIMEOUT_MS: boundedInteger(15_000, 1_000, 120_000),
  DATABASE_TRANSACTION_TIMEOUT_MS: boundedInteger(30_000, 1_000, 300_000),
  SESSION_SECRET: optionalString,
  SESSION_SECRET_PREVIOUS: optionalString,
  MEDIA_URL_SIGNING_SECRET: optionalString,
  MEDIA_URL_SIGNING_SECRET_PREVIOUS: optionalString,
  BIOMETRIC_TEMPLATE_ENCRYPTION_KEY: optionalString,
  JOB_SCHEDULER_TOKEN: optionalString,
  JOB_SCHEDULER_TOKEN_PREVIOUS: optionalString,
  STORAGE_PROVIDER: z.enum(STORAGE_PROVIDERS).default("local"),
  STORAGE_LOCAL_PATH: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_NAME: optionalString,
  PAYMENT_PROVIDER: z.enum(PAYMENT_PROVIDERS).default("noop"),
  BILLING_EMAIL_PROVIDER: z.enum(EMAIL_PROVIDERS).default("noop"),
  INVESTIGATION_NOTIFICATION_PROVIDER: z.enum(EMAIL_PROVIDERS).default("noop"),
  AUDITOR_INVITATION_PROVIDER: z.enum(EMAIL_PROVIDERS).default("noop"),
  RETENTION_NOTIFICATION_PROVIDER: z.enum(EMAIL_PROVIDERS).default("noop"),
  TELEMATICS_PROVIDER: z.enum(TRACKER_PROVIDERS).default("disabled"),
  MONITORING_PROVIDER: z.enum(MONITORING_PROVIDERS).default("disabled"),
  EMAIL_REQUIRED: booleanValue(false),
  PAYMENTS_REQUIRED: booleanValue(false),
  TRACKER_REQUIRED: booleanValue(false),
  DEPLOYMENT_TARGET: optionalString,
  BACKUP_STRATEGY: optionalString,
  BACKUP_LAST_RESTORE_TEST_AT: optionalString,
  INFORMATION_OFFICER_CONFIRMED: booleanValue(false),
  PAIA_MANUAL_CONFIRMED: booleanValue(false),
  PILOT_APPROVED: booleanValue(false),
  PILOT_SUPPORT_OWNER: optionalString,
});

export type RuntimeConfiguration = z.infer<typeof schema>;

export interface RuntimeConfigurationValidation {
  valid: boolean;
  config: RuntimeConfiguration | null;
  issues: ConfigurationIssue[];
}

const PLACEHOLDER_PATTERN = /(change[-_ ]?me|placeholder|example|dev[-_ ]?only|test[-_ ]?only|insecure|mock|your[-_ ])/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

function issue(variable: string, message: string): ConfigurationIssue {
  return { variable, message };
}

function safeUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function validateSecret(variable: string, value: string | undefined, issues: ConfigurationIssue[]): void {
  if (!value) {
    issues.push(issue(variable, "is required for a production release"));
    return;
  }
  if (value.length < 32) issues.push(issue(variable, "must contain at least 32 characters"));
  if (PLACEHOLDER_PATTERN.test(value)) issues.push(issue(variable, "contains an unsafe placeholder marker"));
}

function validateProductionDatabase(variable: string, value: string | undefined, issues: ConfigurationIssue[]): void {
  const parsed = safeUrl(value);
  if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)) {
    issues.push(issue(variable, "must be a valid PostgreSQL URL"));
    return;
  }
  if (LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    issues.push(issue(variable, "must not target a loopback/local development host in production"));
  }
  if (/(^|[_-])(test|dev|local)([_-]|$)/i.test(parsed.pathname.replace(/^\//, ""))) {
    issues.push(issue(variable, "must not target a database whose name is marked test/dev/local"));
  }
}

export function deploymentEnvironmentFor(input: RuntimeEnvironmentInput): DeploymentEnvironment {
  if (input.APP_ENV && DEPLOYMENT_ENVIRONMENTS.includes(input.APP_ENV as DeploymentEnvironment)) {
    return input.APP_ENV as DeploymentEnvironment;
  }
  return input.NODE_ENV === "test" ? "test" : "development";
}

export function validateRuntimeConfiguration(input: RuntimeEnvironmentInput): RuntimeConfigurationValidation {
  const appEnvironment = deploymentEnvironmentFor(input);
  const parsed = schema.safeParse({ ...input, APP_ENV: appEnvironment });
  if (!parsed.success) {
    return {
      valid: false,
      config: null,
      issues: parsed.error.issues.map((entry) =>
        issue(entry.path.join(".") || "configuration", entry.message),
      ),
    };
  }

  const config = parsed.data;
  const issues: ConfigurationIssue[] = [];

  if (config.APP_BASE_URL && !safeUrl(config.APP_BASE_URL)) {
    issues.push(issue("APP_BASE_URL", "must be an absolute URL"));
  }

  if (config.APP_ENV === "test") {
    const database = safeUrl(config.DATABASE_URL);
    if (!database || !/(^|[_-])test([_-]|$)/i.test(database.pathname.replace(/^\//, ""))) {
      issues.push(issue("DATABASE_URL", "must name an explicitly test-marked database when APP_ENV=test"));
    }
    if (config.STORAGE_PROVIDER !== "local") {
      issues.push(issue("STORAGE_PROVIDER", "test environments may only use isolated local storage"));
    }
    if (config.PAYMENT_PROVIDER !== "noop" && config.PAYMENT_PROVIDER !== "mock") {
      issues.push(issue("PAYMENT_PROVIDER", "test environments cannot select a production payment provider"));
    }
    if (!["noop", "mock", "dev-console"].includes(config.BILLING_EMAIL_PROVIDER)) {
      issues.push(issue("BILLING_EMAIL_PROVIDER", "test environments cannot select an external email provider"));
    }
    if (!['disabled', 'mock'].includes(config.TELEMATICS_PROVIDER)) {
      issues.push(issue("TELEMATICS_PROVIDER", "test environments cannot select an external tracker provider"));
    }
  }

  if (config.APP_ENV === "production") {
    const appUrl = safeUrl(config.APP_BASE_URL);
    if (!appUrl || appUrl.protocol !== "https:" || LOCAL_HOSTS.has(appUrl.hostname.toLowerCase())) {
      issues.push(issue("APP_BASE_URL", "must be a non-local HTTPS URL in production"));
    }
    validateProductionDatabase("DATABASE_URL", config.DATABASE_URL, issues);
    validateProductionDatabase("DIRECT_DATABASE_URL", config.DIRECT_DATABASE_URL, issues);
    if (!["require", "verify-full"].includes(config.DATABASE_SSL_MODE)) {
      issues.push(issue("DATABASE_SSL_MODE", "must require TLS in production"));
    }
    validateSecret("SESSION_SECRET", config.SESSION_SECRET, issues);
    validateSecret("MEDIA_URL_SIGNING_SECRET", config.MEDIA_URL_SIGNING_SECRET, issues);
    validateSecret("BIOMETRIC_TEMPLATE_ENCRYPTION_KEY", config.BIOMETRIC_TEMPLATE_ENCRYPTION_KEY, issues);
    validateSecret("JOB_SCHEDULER_TOKEN", config.JOB_SCHEDULER_TOKEN, issues);
    if (config.STORAGE_PROVIDER === "local") {
      issues.push(issue("STORAGE_PROVIDER", "production evidence cannot use the local filesystem provider"));
    }
    if (config.STORAGE_PROVIDER === "r2") {
      for (const variable of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"] as const) {
        if (!config[variable]) issues.push(issue(variable, "is required when STORAGE_PROVIDER=r2"));
      }
    }
    if (config.PAYMENT_PROVIDER === "mock") {
      issues.push(issue("PAYMENT_PROVIDER", "mock payment success is forbidden in production"));
    }
    for (const [variable, provider] of [
      ["BILLING_EMAIL_PROVIDER", config.BILLING_EMAIL_PROVIDER],
      ["INVESTIGATION_NOTIFICATION_PROVIDER", config.INVESTIGATION_NOTIFICATION_PROVIDER],
      ["AUDITOR_INVITATION_PROVIDER", config.AUDITOR_INVITATION_PROVIDER],
      ["RETENTION_NOTIFICATION_PROVIDER", config.RETENTION_NOTIFICATION_PROVIDER],
    ] as const) {
      if (provider === "mock" || provider === "dev-console") {
        issues.push(issue(variable, "mock/dev-console delivery is forbidden in production"));
      }
    }
    if (config.TELEMATICS_PROVIDER === "mock") {
      issues.push(issue("TELEMATICS_PROVIDER", "mock tracker data is forbidden in production"));
    }
    if (config.EMAIL_REQUIRED && config.BILLING_EMAIL_PROVIDER !== "transactional") {
      issues.push(issue("BILLING_EMAIL_PROVIDER", "must select the approved transactional adapter when EMAIL_REQUIRED=true"));
    }
    if (config.PAYMENTS_REQUIRED && config.PAYMENT_PROVIDER === "noop") {
      issues.push(issue("PAYMENT_PROVIDER", "must select the approved payment adapter when PAYMENTS_REQUIRED=true"));
    }
    if (config.TRACKER_REQUIRED && config.TELEMATICS_PROVIDER === "disabled") {
      issues.push(issue("TELEMATICS_PROVIDER", "must select the approved tracker adapter when TRACKER_REQUIRED=true"));
    }
  }

  return { valid: issues.length === 0, config, issues };
}

export class RuntimeConfigurationError extends Error {
  readonly issues: ConfigurationIssue[];

  constructor(issues: ConfigurationIssue[]) {
    super(`Runtime configuration is invalid: ${issues.map((entry) => `${entry.variable} ${entry.message}`).join("; ")}`);
    this.name = "RuntimeConfigurationError";
    this.issues = issues;
  }
}
