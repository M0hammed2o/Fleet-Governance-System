import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getGateEventInTenant } from "@/lib/repositories/gate-event-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("gateEvent", "VIEW");
    const { id } = await params;
    const gateEvent = await getGateEventInTenant(session.tenantId, id);
    if (!gateEvent) throw new ApiError(404, "Gate event not found");
    return NextResponse.json({ gateEvent });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
