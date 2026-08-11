export interface RequestPolicyInput {
  method: string;
  pathname: string;
  origin: string | null;
  requestOrigin: string;
  secFetchSite: string | null;
  configuredOrigins: readonly string[];
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normaliseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isCsrfExemptPath(pathname: string): boolean {
  return pathname === "/api/billing/webhook" || pathname.startsWith("/api/jobs/");
}

export function evaluateRequestPolicy(input: RequestPolicyInput): { allowed: true } | { allowed: false; reason: string } {
  if (SAFE_METHODS.has(input.method.toUpperCase()) || isCsrfExemptPath(input.pathname)) return { allowed: true };
  if (input.secFetchSite === "cross-site") return { allowed: false, reason: "cross-site mutation denied" };
  if (!input.origin) return { allowed: true };
  const origin = normaliseOrigin(input.origin);
  const allowedOrigins = new Set(
    [input.requestOrigin, ...input.configuredOrigins]
      .map(normaliseOrigin)
      .filter((value): value is string => value !== null),
  );
  return origin && allowedOrigins.has(origin)
    ? { allowed: true }
    : { allowed: false, reason: "untrusted request origin" };
}
