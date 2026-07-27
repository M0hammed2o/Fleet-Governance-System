import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { reissueInvoice, InvoiceNotFoundError, InvoiceMustBeVoidedBeforeReissueError } from "@/lib/repositories/invoice-repository";
import { reissueInvoiceSchema } from "@/lib/validation/billing";

/** P10E — controlled invoice reissue (must already be voided), platform-admin only. */
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string; invoiceId: string }> }) {
  try {
    const session = await requireApiPermission("invoice", "EDIT");
    const { invoiceId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = reissueInvoiceSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const invoice = await reissueInvoice(session, invoiceId, parsed.data.reason);
    return NextResponse.json({ invoice });
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof InvoiceMustBeVoidedBeforeReissueError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
