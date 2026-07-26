import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { getCustomerStorageDashboard } from "@/lib/repositories/storage-dashboard-repository";

/** Customer-admin storage page (Phase 8D) — the caller's own tenant only. */
export async function GET() {
  try {
    const session = await requireApiPermission("retention", "VIEW");
    const row = await getCustomerStorageDashboard(session.tenantId);
    return NextResponse.json({ row });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
