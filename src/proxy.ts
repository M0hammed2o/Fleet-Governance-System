import { NextResponse, type NextRequest } from "next/server";
import { evaluateRequestPolicy } from "@/lib/security/request-policy";
import {
  allowedMobileOrigin,
  configuredMobileOrigins,
  mobileCorsHeaders,
} from "@/lib/mobile/cors";

export function proxy(request: NextRequest) {
  const mobileRequest = request.nextUrl.pathname.startsWith("/api/mobile/");
  const mobileOrigins = configuredMobileOrigins();
  const mobileOrigin = mobileRequest
    ? allowedMobileOrigin(request.headers.get("origin"), mobileOrigins)
    : null;
  const configuredOrigins = [
    process.env.APP_BASE_URL,
    ...(process.env.AUTH_TRUSTED_ORIGINS ?? "").split(","),
    ...(mobileRequest ? [...mobileOrigins] : []),
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
  if (mobileRequest && request.method === "OPTIONS") {
    if (!mobileOrigin)
      return NextResponse.json(
        { error: "Request origin rejected." },
        { status: 403 },
      );
    return new NextResponse(null, { status: 204, headers: mobileCorsHeaders(mobileOrigin) });
  }

  const requestHeaders = new Headers(request.headers);
  const candidate = request.headers.get("x-request-id");
  const requestId = candidate && /^[A-Za-z0-9._:-]{8,128}$/.test(candidate)
    ? candidate
    : crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  if (mobileOrigin)
    mobileCorsHeaders(mobileOrigin).forEach((value, key) =>
      response.headers.set(key, value),
    );
  return response;
}

export const config = { matcher: "/api/:path*" };
