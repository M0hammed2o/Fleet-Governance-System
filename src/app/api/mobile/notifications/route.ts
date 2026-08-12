import { NextResponse } from "next/server";
import {
  requireMobileSession,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { listMobileNotifications } from "@/lib/mobile/notifications";
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    const page = Math.max(
      1,
      Number(new URL(request.url).searchParams.get("page") ?? "1") || 1,
    );
    return NextResponse.json(await listMobileNotifications(session, page), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
