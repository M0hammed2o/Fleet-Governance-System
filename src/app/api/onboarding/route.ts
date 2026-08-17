import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import { getOnboardingSummary, updateOnboarding } from "@/lib/repositories/onboarding-repository";
import { onboardingUpdateSchema } from "@/lib/validation/demo";

export async function GET() {
  try {
    const session = await requireApiPermission("tenant", "VIEW");
    const summary = await getOnboardingSummary(session.tenantId);
    if (!summary) throw new ApiError(404, "Company workspace not found");
    return NextResponse.json(summary);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApiPermission("tenant", "CONFIGURE");
    const parsed = onboardingUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid onboarding data");
    await updateOnboarding(session.tenantId, session.userId, parsed.data);
    const summary = await getOnboardingSummary(session.tenantId);
    return NextResponse.json(summary);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
