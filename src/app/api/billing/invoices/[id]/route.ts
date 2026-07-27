import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getInvoiceForTenant, InvoiceNotFoundError } from "@/lib/repositories/invoice-repository";

/** P10J — one invoice belonging to the caller's own tenant. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("invoice", "VIEW");
    const { id } = await params;
    const invoice = await getInvoiceForTenant(session, session.tenantId, id);
    return NextResponse.json({ invoice });
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
