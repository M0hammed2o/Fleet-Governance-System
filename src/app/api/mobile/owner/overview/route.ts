import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import { hasPermission } from "@/lib/auth/authorize";
import {
  requireMobileSession,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { getMobileOwnerOverview } from "@/lib/mobile/owner-overview";
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    if (
      !(await hasPermission(session, "governanceAnalytics", "VIEW")) &&
      !(await hasPermission(session, "movement", "APPROVE"))
    )
      throw new ApiError(403, "Executive overview is not permitted.");
    return NextResponse.json(await getMobileOwnerOverview(session), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
