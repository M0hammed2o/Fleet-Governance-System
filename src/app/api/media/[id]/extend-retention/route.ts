import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { extendRetention, MediaAssetNotFoundError } from "@/lib/repositories/retention-repository";
import { extendRetentionSchema } from "@/lib/validation/retention";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("retention", "CONFIGURE");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = extendRetentionSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const mediaAsset = await extendRetention(session.tenantId, session.userId, id, parsed.data.newScheduledDeletionAt, parsed.data.reason);
    return NextResponse.json({ mediaAsset });
  } catch (err) {
    if (err instanceof MediaAssetNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
