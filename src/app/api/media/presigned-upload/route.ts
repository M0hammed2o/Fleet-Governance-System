import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { initiatePresignedUpload, MediaOwnerNotFoundError } from "@/lib/repositories/media-asset-repository";
import { initiatePresignedUploadSchema } from "@/lib/validation/media";

// Needs real filesystem access (LocalFilesystemStorageProvider) — Node
// runtime, not edge.
export const runtime = "nodejs";

/**
 * Reserves a storage key and mints a presigned direct-to-storage upload URL
 * (Phase 8B) — the client PUTs the raw bytes straight to `uploadUrl`
 * (bypassing this app's request thread, ARCHITECTURE.md "Technical
 * constraints"), then calls `POST /api/media/[id]/confirm-upload` once done.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("mediaAsset", "CREATE");

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");

    const parsed = initiatePresignedUploadSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const result = await initiatePresignedUpload({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      ownerType: parsed.data.ownerType,
      ownerId: parsed.data.ownerId,
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
      idempotencyKey: parsed.data.idempotencyKey,
      category: parsed.data.category,
      captureMetadata: parsed.data.captureMetadata,
    });

    return NextResponse.json(
      {
        mediaAssetId: result.mediaAsset.id,
        uploadUrl: result.uploadUrl,
        method: result.method,
        headers: result.headers,
        expiresAt: result.expiresAt,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof MediaOwnerNotFoundError) {
      return apiErrorResponse(new ApiError(404, err.message));
    }
    return apiErrorResponse(err);
  }
}
