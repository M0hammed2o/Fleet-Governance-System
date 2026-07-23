import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getReconciliationInTenant } from "@/lib/repositories/reconciliation-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("reconciliation", "VIEW");
    const { id } = await params;
    const reconciliation = await getReconciliationInTenant(session.tenantId, id);
    if (!reconciliation) throw new ApiError(404, "Reconciliation not found");
    return NextResponse.json({ reconciliation });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
