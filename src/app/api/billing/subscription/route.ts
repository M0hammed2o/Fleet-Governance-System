import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { getTenantSubscription } from "@/lib/repositories/subscription-repository";

/** P10J/K — the caller's own tenant's subscription status. */
export async function GET() {
  try {
    const session = await requireApiPermission("tenantSubscription", "VIEW");
    const subscription = await getTenantSubscription(session, session.tenantId);
    return NextResponse.json({ subscription });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
