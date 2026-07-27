import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { listPaymentsForTenant } from "@/lib/repositories/payment-repository";

/** P10J — the caller's own tenant's payment history. */
export async function GET() {
  try {
    const session = await requireApiPermission("payment", "VIEW");
    const payments = await listPaymentsForTenant(session, session.tenantId);
    return NextResponse.json({ payments });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
