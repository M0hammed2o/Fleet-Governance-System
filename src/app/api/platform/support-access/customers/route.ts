import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse } from "@/lib/auth/api-guard";
import { getCustomerHealthSummaries } from "@/lib/repositories/support-access-repository";

/** SUPPORT-001 — platform customer list with health/status summary. */
export async function GET() {
  try {
    const session = await requireApiSession();
    const summaries = await getCustomerHealthSummaries(session);
    return NextResponse.json({ customers: summaries });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
