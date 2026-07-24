import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse } from "@/lib/auth/api-guard";
import { listSupportAccessSessionsForCustomer } from "@/lib/repositories/support-access-repository";

/** SUPPORT-002 "auditable" — full session history for one customer tenant. */
export async function GET(request: Request, { params }: { params: Promise<{ customerTenantId: string }> }) {
  try {
    const session = await requireApiSession();
    const { customerTenantId } = await params;
    const sessions = await listSupportAccessSessionsForCustomer(session, customerTenantId);
    return NextResponse.json({ sessions });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
