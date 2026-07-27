import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { listBillingEmailDeliveriesForInvoice } from "@/lib/repositories/billing-email-repository";

/** P10H/J — billing-email delivery history for one of the caller's own tenant's invoices. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("billingEmail", "VIEW");
    const { id } = await params;
    const deliveries = await listBillingEmailDeliveriesForInvoice(session, id);
    return NextResponse.json({ deliveries });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
