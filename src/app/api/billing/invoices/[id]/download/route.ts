import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getInvoicePdfDownloadUrl, InvoiceNotFoundError, InvoicePdfNotReadyError } from "@/lib/repositories/invoice-repository";
import { ForbiddenError } from "@/lib/auth/authorize";

/** P10E/J — a signed, short-lived download URL for the caller's own tenant's invoice PDF. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const { url, expiresAt } = await getInvoicePdfDownloadUrl(session, session.tenantId, id);
    return NextResponse.json({ url, expiresAt });
  } catch (err) {
    if (err instanceof ForbiddenError) return apiErrorResponse(new ApiError(403, "Forbidden"));
    if (err instanceof InvoiceNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof InvoicePdfNotReadyError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
