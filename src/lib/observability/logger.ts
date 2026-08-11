import "server-only";
import crypto from "node:crypto";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(password|passphrase|secret|token|authorization|cookie|session|api[-_]?key|access[-_]?key|private[-_]?key|credential|cvv|card|bank|biometric|descriptor|template|allegation|caseTitle|messageBody|raw)/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(URL_CREDENTIAL_PATTERN, "$1[REDACTED]@")
    .replace(EMAIL_PATTERN, REDACTED)
    .slice(0, 2_000);
}

export function redactForLogging(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[BINARY ${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactForLogging(entry, key, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [entryKey, redactForLogging(entryValue, entryKey, seen)]),
    );
  }
  return String(value);
}

export function normaliseCorrelationId(value: string | null | undefined): string {
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : crypto.randomUUID();
}

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, event: string, context: Record<string, unknown> = {}): void {
  const safeContext = redactForLogging(context) as Record<string, unknown>;
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: event.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 120),
    ...safeContext,
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
}

export const logger = {
  info: (event: string, context?: Record<string, unknown>) => write("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => write("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => write("error", event, context),
};
