export interface RequestPolicyInput {
  method: string;
  pathname: string;
  origin: string | null;
  requestOrigin: string;
  secFetchSite: string | null;
  configuredOrigins: readonly string[];
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normaliseOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:", "capacitor:", "ionic:"].includes(url.protocol))
      return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.protocol === "capacitor:" || url.protocol === "ionic:"
      ? `${url.protocol}//${url.host}`
      : url.origin;
  } catch {
    return null;
  }
}

export function isCsrfExemptPath(pathname: string): boolean {
  return pathname === "/api/billing/webhook" || pathname.startsWith("/api/jobs/");
}

export function evaluateRequestPolicy(input: RequestPolicyInput): { allowed: true } | { allowed: false; reason: string } {
  if (SAFE_METHODS.has(input.method.toUpperCase()) || isCsrfExemptPath(input.pathname)) return { allowed: true };
  const origin = normaliseOrigin(input.origin);
  const allowedOrigins = new Set(
    [input.requestOrigin, ...input.configuredOrigins]
      .map(normaliseOrigin)
      .filter((value): value is string => value !== null),
  );
  if (origin && allowedOrigins.has(origin)) return { allowed: true };
  if (input.secFetchSite === "cross-site")
    return { allowed: false, reason: "cross-site mutation denied" };
  if (!input.origin) return { allowed: true };
  return { allowed: false, reason: "untrusted request origin" };
}
