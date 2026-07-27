import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { voidInvoice, InvoiceNotFoundError, InvoiceAlreadyVoidError, InvoiceAlreadyPaidError } from "@/lib/repositories/invoice-repository";
import { voidInvoiceSchema } from "@/lib/validation/billing";

/** P10E — controlled invoice void, platform-admin only, always with an audited reason. */
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string; invoiceId: string }> }) {
  try {
    const session = await requireApiPermission("invoice", "EDIT");
    const { invoiceId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = voidInvoiceSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const invoice = await voidInvoice(session, invoiceId, parsed.data.reason);
    return NextResponse.json({ invoice });
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof InvoiceAlreadyVoidError || err instanceof InvoiceAlreadyPaidError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
