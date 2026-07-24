import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  getSupportViewForCustomer,
  SupportAccessSessionNotActiveError,
  CustomerTenantNotFoundError,
} from "@/lib/repositories/support-access-repository";

/** SUPPORT-003 — the controlled support view itself; requires an active session. */
export async function GET(request: Request, { params }: { params: Promise<{ customerTenantId: string }> }) {
  try {
    const session = await requireApiSession();
    const { customerTenantId } = await params;
    const view = await getSupportViewForCustomer(session, customerTenantId);
    return NextResponse.json({ view });
  } catch (err) {
    if (err instanceof SupportAccessSessionNotActiveError) return apiErrorResponse(new ApiError(403, err.message));
    if (err instanceof CustomerTenantNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
