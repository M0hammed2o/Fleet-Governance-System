import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { processPaymentProviderEvent } from "@/lib/repositories/payment-repository";
import { InvalidWebhookSignatureError } from "@/lib/billing/payment-provider";

/**
 * P10F/G — the payment provider's webhook endpoint. Deliberately no
 * session/permission check (a webhook has no user session at all) —
 * authenticity is instead verified inside processPaymentProviderEvent via
 * the configured provider's own signature scheme before any of the
 * payload's business content is trusted. Never assume a request reaching
 * this route is genuine just because it arrived here.
 */
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const result = await processPaymentProviderEvent(rawBody, headers);
    return NextResponse.json({ result: result.outcome });
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) return apiErrorResponse(new ApiError(401, err.message));
    return apiErrorResponse(err);
  }
}
