import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  mobileApiErrorResponse,
  requireMobilePermission,
} from "@/lib/mobile/mobile-api-guard";
import { listMobileManualFallbacks } from "@/lib/mobile/facial-verification";

export async function GET(request: Request) {
  try {
    const session = await requireMobilePermission(
      request,
      "facialVerificationFallback",
      "VIEW",
    );
    const value = new URL(request.url).searchParams.get("status") ?? "PENDING";
    if (!(["PENDING", "APPROVED", "DENIED"] as const).includes(value as never))
      throw new ApiError(400, "Invalid fallback status.");
    const fallbacks = await listMobileManualFallbacks(
      session.tenantId,
      value as "PENDING" | "APPROVED" | "DENIED",
      session.userId,
    );
    return NextResponse.json(
      { fallbacks },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
