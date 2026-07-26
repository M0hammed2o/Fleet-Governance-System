import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse } from "@/lib/auth/api-guard";
import { getPlatformStorageDashboard } from "@/lib/repositories/storage-dashboard-repository";

/** Platform-admin storage dashboard (Phase 8D) — every customer tenant's aggregate storage/retention posture. Permission-checked inside the repository (`platformTenant:VIEW`, same tier as SUPPORT-001). */
export async function GET() {
  try {
    const session = await requireApiSession();
    const rows = await getPlatformStorageDashboard(session);
    return NextResponse.json({ rows });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
