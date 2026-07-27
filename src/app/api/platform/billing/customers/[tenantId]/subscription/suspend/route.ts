import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { suspendTenantSubscription, TenantSubscriptionNotPastDueError } from "@/lib/repositories/subscription-repository";
import { suspendSubscriptionSchema } from "@/lib/validation/billing";
import { ForbiddenError } from "@/lib/auth/authorize";

/** P10I/K — an explicit platform-admin suspension (requires tenantSubscription:CONFIGURE, checked inside the repository call). */
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const session = await requireApiSession();
    const { tenantId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = suspendSubscriptionSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const subscription = await suspendTenantSubscription(tenantId, parsed.data.reason, session);
    return NextResponse.json({ subscription });
  } catch (err) {
    if (err instanceof ForbiddenError) return apiErrorResponse(new ApiError(403, "Forbidden"));
    if (err instanceof TenantSubscriptionNotPastDueError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
