import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth/session";
import { checkLoginRateLimit, normaliseClientIp, recordAuthenticationAttempt } from "@/lib/auth/login-rate-limit";
import { isDemoRegistrationEnabled } from "@/lib/demo/environment";
import { DemoRegistrationRejectedError, provisionDemoWorkspace } from "@/lib/demo/registration";
import { demoRegistrationSchema } from "@/lib/validation/demo";

const GENERIC_REGISTRATION_ERROR = "The demonstration workspace could not be created. Check the details or use different account information.";

export async function GET() {
  return NextResponse.json({ enabled: isDemoRegistrationEnabled() });
}

export async function POST(request: Request) {
  if (!isDemoRegistrationEnabled()) {
    return NextResponse.json({ error: "Demonstration registration is not available in this environment." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = demoRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const ip = normaliseClientIp(request.headers.get("x-forwarded-for"));
  const throttleInput = { tenantSlug: "demo-registration", email: parsed.data.email, ip };
  const rateLimit = await checkLoginRateLimit(throttleInput);
  if (rateLimit.limited) {
    return NextResponse.json({ error: "Too many registration attempts. Try again later." }, { status: 429, headers: { "Retry-After": "900" } });
  }

  try {
    const result = await provisionDemoWorkspace(parsed.data);
    await setSessionCookie(result.token);
    await recordAuthenticationAttempt({ ...throttleInput, succeeded: true });
    return NextResponse.json({ ok: true, tenantSlug: result.tenantSlug }, { status: 201 });
  } catch (error) {
    await recordAuthenticationAttempt({ ...throttleInput, succeeded: false });
    if (error instanceof DemoRegistrationRejectedError) {
      return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 400 });
    }
    return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 500 });
  }
}
