import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { initiateProviderPayment, InvoiceForPaymentNotFoundError, InvoiceNotPayableError } from "@/lib/repositories/payment-repository";
import { initiateProviderPaymentSchema } from "@/lib/validation/billing";

/** P10G/J — a customer Accountant initiates a mock/configured-provider payment for one of their own invoices. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("payment", "CREATE");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = initiateProviderPaymentSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const result = await initiateProviderPayment(session, id, parsed.data.returnUrl ?? "/admin/billing");
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InvoiceForPaymentNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof InvoiceNotPayableError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
