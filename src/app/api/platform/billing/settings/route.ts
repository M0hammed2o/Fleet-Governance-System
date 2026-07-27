import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getPlatformBillingSettings, updatePlatformBillingSettings, VatConfigurationError } from "@/lib/repositories/platform-billing-repository";
import { updatePlatformBillingSettingsSchema } from "@/lib/validation/billing";

/** P10B — platform-wide billing configuration. Platform Administrator only. */
export async function GET() {
  try {
    await requireApiPermission("platformBilling", "VIEW");
    const settings = await getPlatformBillingSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApiPermission("platformBilling", "CONFIGURE");
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = updatePlatformBillingSettingsSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const settings = await updatePlatformBillingSettings(session, parsed.data);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof VatConfigurationError) return apiErrorResponse(new ApiError(400, err.message));
    return apiErrorResponse(err);
  }
}
