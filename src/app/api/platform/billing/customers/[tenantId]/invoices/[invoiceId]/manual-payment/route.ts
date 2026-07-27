import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  recordManualPayment,
  InvoiceForPaymentNotFoundError,
  InvoiceNotPayableError,
  ManualPaymentAmountMismatchError,
  ManualPaymentRequiresProofReferenceError,
} from "@/lib/repositories/payment-repository";
import { recordManualPaymentSchema } from "@/lib/validation/billing";

/** P10G/I — an authorised platform finance user records a manual payment (e.g. EFT), always proof-referenced and clearly labelled MANUAL. */
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string; invoiceId: string }> }) {
  try {
    const session = await requireApiPermission("payment", "CREATE");
    const { invoiceId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = recordManualPaymentSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const payment = await recordManualPayment(session, invoiceId, parsed.data);
    return NextResponse.json({ payment });
  } catch (err) {
    if (err instanceof InvoiceForPaymentNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof InvoiceNotPayableError || err instanceof ManualPaymentAmountMismatchError || err instanceof ManualPaymentRequiresProofReferenceError) {
      return apiErrorResponse(new ApiError(400, err.message));
    }
    return apiErrorResponse(err);
  }
}
