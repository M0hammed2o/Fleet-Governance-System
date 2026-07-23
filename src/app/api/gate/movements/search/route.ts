import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { searchMovementsForGate } from "@/lib/repositories/movement-repository";

// Read-only by design — there is deliberately no PATCH/PUT here. Gate
// security confirms against the already-approved record; it must never be
// able to modify the original delivery information from this surface (build
// brief 7.5/Phase 2 scope clarification).
export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("movement", "VIEW");
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const movements = await searchMovementsForGate(session.tenantId, q);
    return NextResponse.json({ movements });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
