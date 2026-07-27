import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listCustomerBillingContacts, createCustomerBillingContact } from "@/lib/repositories/tenant-billing-repository";
import { createCustomerBillingContactSchema } from "@/lib/validation/billing";

/** P10C/J — additional billing-email recipients for the caller's own tenant. */
export async function GET() {
  try {
    const session = await requireApiPermission("tenantBilling", "VIEW");
    const contacts = await listCustomerBillingContacts(session, session.tenantId);
    return NextResponse.json({ contacts });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("tenantBilling", "EDIT");
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = createCustomerBillingContactSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const contact = await createCustomerBillingContact(session, session.tenantId, parsed.data);
    return NextResponse.json({ contact });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
