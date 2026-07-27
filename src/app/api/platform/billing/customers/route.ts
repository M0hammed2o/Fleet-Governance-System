import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { getPlatformBillingDashboard } from "@/lib/repositories/platform-billing-repository";

/** P10I — platform-admin billing dashboard: every client tenant's billing summary. */
export async function GET() {
  try {
    const session = await requireApiPermission("platformBilling", "VIEW");
    const rows = await getPlatformBillingDashboard(session);
    return NextResponse.json({ rows });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
