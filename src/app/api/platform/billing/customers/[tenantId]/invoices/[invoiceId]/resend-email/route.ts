import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { resendInvoiceEmail, InvoiceForResendNotFoundError } from "@/lib/repositories/billing-email-repository";
import { resendInvoiceEmailSchema } from "@/lib/validation/billing";

/** P10H/I — an authorised resend of an invoice PDF email, platform-admin side. */
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string; invoiceId: string }> }) {
  try {
    const session = await requireApiPermission("billingEmail", "CREATE");
    const { invoiceId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = resendInvoiceEmailSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const delivery = await resendInvoiceEmail(session, invoiceId, parsed.data.recipientEmail);
    return NextResponse.json({ delivery });
  } catch (err) {
    if (err instanceof InvoiceForResendNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
