import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { listInvoicesForTenant } from "@/lib/repositories/invoice-repository";

/** P10J — the caller's own tenant's invoices (customer Accountant portal). */
export async function GET() {
  try {
    const session = await requireApiPermission("invoice", "VIEW");
    const invoices = await listInvoicesForTenant(session, session.tenantId);
    return NextResponse.json({ invoices });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
