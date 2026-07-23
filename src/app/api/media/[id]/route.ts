import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { mintSignedUrlForMediaAsset } from "@/lib/repositories/media-asset-repository";

/**
 * Mints a short-lived signed read URL for one MediaAsset — the only
 * sanctioned way to obtain a usable link to evidence (EVID-002). Never
 * returns a raw/permanent path; the caller must then GET the returned `url`
 * (`/api/media/raw?...`) before it expires.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("mediaAsset", "VIEW");
    const { id } = await params;

    const result = await mintSignedUrlForMediaAsset(session.tenantId, session.userId, id);
    if (!result) throw new ApiError(404, "Media asset not found");

    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
