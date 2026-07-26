import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { moveAssetsToArchive } from "@/lib/repositories/retention-repository";
import { archiveAssetsSchema } from "@/lib/validation/retention";

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("retention", "CONFIGURE");
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = archiveAssetsSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const result = await moveAssetsToArchive(session.tenantId, session.userId, parsed.data.mediaAssetIds);
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
