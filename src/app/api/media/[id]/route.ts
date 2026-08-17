import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { mintSignedUrlForMediaAsset } from "@/lib/repositories/media-asset-repository";
import { deleteReplaceableMediaAsset, MediaDeletionBlockedError } from "@/lib/repositories/media-asset-repository";
import { z } from "zod";

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

const deleteSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("mediaAsset", "DELETE");
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "A deletion reason is required");
    const { id } = await params;
    const asset = await deleteReplaceableMediaAsset(session.tenantId, session.userId, id, parsed.data.reason);
    if (!asset) throw new ApiError(404, "Media asset not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MediaDeletionBlockedError) return apiErrorResponse(new ApiError(409, error.message));
    return apiErrorResponse(error);
  }
}
