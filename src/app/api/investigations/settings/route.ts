import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { getOrCreateTenantInvestigationSettings, updateTenantInvestigationSettings } from "@/lib/repositories/investigation-case-repository";
import { updateInvestigationSettingsSchema } from "@/lib/validation/investigations";

export async function GET() {
  try {
    const session = await requireApiSession();
    const settings = await getOrCreateTenantInvestigationSettings(session.tenantId);
    return NextResponse.json({ settings });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApiSession();
    const body = await request.json().catch(() => null);
    const parsed = updateInvestigationSettingsSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const settings = await updateTenantInvestigationSettings(session, parsed.data);
    return NextResponse.json({ settings });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
