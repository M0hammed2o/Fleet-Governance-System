import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { completeDueDeletionRequests } from "@/lib/repositories/retention-repository";

/**
 * Cross-tenant batch job: completes every APPROVED deletion request across
 * every tenant whose recovery period has elapsed. Gated by `platformTenant:
 * CONFIGURE` (Platform Administrator only) since it operates across tenant
 * boundaries by design — not a customer-tenant action. Not yet wired to any
 * scheduler (no scheduling infrastructure exists in this codebase yet, same
 * documented gap as the existing `expireMovement` auto-transition,
 * TODO.md); callable on demand until a real scheduler exists.
 */
export async function POST() {
  try {
    await requireApiPermission("platformTenant", "CONFIGURE");
    const certificates = await completeDueDeletionRequests();
    return NextResponse.json({ processedCount: certificates.length, certificates });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
