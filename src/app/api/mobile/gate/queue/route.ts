import { NextResponse } from "next/server";
import {
  requireMobilePermission,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { getMobileGateQueue } from "@/lib/mobile/gate-queue";
export async function GET(request: Request) {
  try {
    const session = await requireMobilePermission(request, "gateEvent", "VIEW");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    return NextResponse.json(
      await getMobileGateQueue(session, {
        query: url.searchParams.get("q") ?? "",
        page,
      }),
    );
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
