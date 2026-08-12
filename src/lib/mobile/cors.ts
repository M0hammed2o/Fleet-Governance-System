function normalizeOrigin(value: string): string | null {
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

export function configuredMobileOrigins(
  value = process.env.MOBILE_TRUSTED_ORIGINS ?? "",
): Set<string> {
  const origins = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin)
    .filter((item): item is string => Boolean(item));
  return new Set(origins);
}

export function allowedMobileOrigin(
  origin: string | null,
  configured = configuredMobileOrigins(),
): string | null {
  if (!origin) return null;
  const normalized = normalizeOrigin(origin);
  return normalized && configured.has(normalized) ? normalized : null;
}

export function mobileCorsHeaders(origin: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization,Content-Type,Idempotency-Key,X-Request-Id",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
}
