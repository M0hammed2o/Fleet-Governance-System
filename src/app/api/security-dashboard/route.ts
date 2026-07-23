import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { getSecurityDashboardData } from "@/lib/repositories/security-dashboard-repository";

export async function GET() {
  try {
    const session = await requireApiPermission("gateEvent", "VIEW");
    const data = await getSecurityDashboardData(session.tenantId);
    return NextResponse.json(data);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
