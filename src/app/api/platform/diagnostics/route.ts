import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { getJobDiagnostics, getProductionReadinessReport } from "@/lib/operations/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApiPermission("platformTenant", "CONFIGURE");
    const [readiness, jobs] = await Promise.all([
      getProductionReadinessReport(),
      getJobDiagnostics(),
    ]);
    return NextResponse.json(
      { readiness, jobs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
