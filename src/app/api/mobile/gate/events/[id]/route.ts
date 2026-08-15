import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  requireMobilePermission,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { getGateEventInTenant } from "@/lib/repositories/gate-event-repository";
import { getMobileFacialVerificationContext } from "@/lib/mobile/facial-verification";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireMobilePermission(request, "gateEvent", "VIEW");
    const { id } = await params;
    const event = await getGateEventInTenant(session.tenantId, id);
    if (!event) throw new ApiError(404, "Gate event not found.");
    const identity = await getMobileFacialVerificationContext(
      session.tenantId,
      id,
      session.userId,
    );
    return NextResponse.json(
      { gateEvent: { ...event, identity } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
