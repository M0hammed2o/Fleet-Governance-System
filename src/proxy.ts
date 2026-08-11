import { NextResponse, type NextRequest } from "next/server";
import { evaluateRequestPolicy } from "@/lib/security/request-policy";

export function proxy(request: NextRequest) {
  const configuredOrigins = [
    process.env.APP_BASE_URL,
    ...(process.env.AUTH_TRUSTED_ORIGINS ?? "").split(","),
  ].filter((value): value is string => Boolean(value?.trim()));
  const policy = evaluateRequestPolicy({
    method: request.method,
    pathname: request.nextUrl.pathname,
    origin: request.headers.get("origin"),
    requestOrigin: request.nextUrl.origin,
    secFetchSite: request.headers.get("sec-fetch-site"),
    configuredOrigins,
  });
  if (!policy.allowed) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  const requestHeaders = new Headers(request.headers);
  const candidate = request.headers.get("x-request-id");
  const requestId = candidate && /^[A-Za-z0-9._:-]{8,128}$/.test(candidate)
    ? candidate
    : crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = { matcher: "/api/:path*" };
