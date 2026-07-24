import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { startSupportAccessSession, CustomerTenantNotFoundError } from "@/lib/repositories/support-access-repository";
import { startSupportAccessSessionSchema } from "@/lib/validation/support-access";

/** SUPPORT-002 — start a time-limited, audited support-access session. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const body = await request.json().catch(() => null);
    const parsed = startSupportAccessSessionSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const accessSession = await startSupportAccessSession({
      session,
      customerTenantId: parsed.data.customerTenantId,
      reason: parsed.data.reason,
      ticketReference: parsed.data.ticketReference,
    });
    return NextResponse.json({ accessSession }, { status: 201 });
  } catch (err) {
    if (err instanceof CustomerTenantNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
