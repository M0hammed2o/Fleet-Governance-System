import { NextResponse } from "next/server";
import {
  requireMobileSession,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { createMobileBootstrap } from "@/lib/mobile/bootstrap";
export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await createMobileBootstrap(await requireMobileSession(request)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
