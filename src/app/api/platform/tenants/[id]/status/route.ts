import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { setTenantStatusAsPlatformAdmin } from "@/lib/repositories/platform-tenant-repository";
import { tenantStatusSchema } from "@/lib/validation/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = tenantStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const tenant = await setTenantStatusAsPlatformAdmin(session, id, parsed.data.status);
    return NextResponse.json({ tenant });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
