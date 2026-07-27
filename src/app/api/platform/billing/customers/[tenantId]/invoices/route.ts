import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listInvoicesForTenant, getInvoiceWithDetailsUnchecked } from "@/lib/repositories/invoice-repository";
import { generateBillableVehicleSnapshot } from "@/lib/repositories/billable-vehicle-repository";
import { generateInvoiceForBillingPeriod } from "@/lib/repositories/invoice-repository";
import { generateInvoiceSchema } from "@/lib/validation/billing";

/** P10I — a customer tenant's invoices, and manual generate-now (platform-admin only). */
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const session = await requireApiPermission("invoice", "VIEW");
    const { tenantId } = await params;
    const invoices = await listInvoicesForTenant(session, tenantId);
    return NextResponse.json({ invoices });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** Manually generates (or returns the already-existing) invoice for the given period — same idempotent path the recurring job uses. */
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const session = await requireApiPermission("invoice", "CREATE");
    const { tenantId } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = generateInvoiceSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const reference = parsed.data.periodStart ?? new Date();
    const snapshot = await generateBillableVehicleSnapshot(tenantId, reference, session.userId);
    const invoice = await generateInvoiceForBillingPeriod(snapshot.billingPeriodId, session.userId);
    const full = await getInvoiceWithDetailsUnchecked(invoice.id);

    return NextResponse.json({ invoice: full });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
