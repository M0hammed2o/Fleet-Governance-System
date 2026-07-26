import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  confirmPresignedUpload,
  PendingUploadNotFoundError,
  UploadNeverCompletedError,
  InvalidFileTypeError,
  EmptyFileError,
  FileTooLargeError,
  MediaProcessingError,
} from "@/lib/repositories/media-asset-repository";

// Needs real filesystem access (LocalFilesystemStorageProvider) — Node
// runtime, not edge.
export const runtime = "nodejs";

/**
 * Confirms a presigned upload actually completed (Phase 8B) — verifies the
 * object exists, runs the compression pipeline, and moves the MediaAsset
 * from PENDING to READY (or FAILED, typed, never a raw 500).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("mediaAsset", "CREATE");
    const { id } = await params;

    const mediaAsset = await confirmPresignedUpload(session.tenantId, session.userId, id);

    return NextResponse.json({ mediaAsset });
  } catch (err) {
    if (err instanceof PendingUploadNotFoundError) {
      return apiErrorResponse(new ApiError(404, err.message));
    }
    if (
      err instanceof UploadNeverCompletedError ||
      err instanceof InvalidFileTypeError ||
      err instanceof EmptyFileError ||
      err instanceof FileTooLargeError ||
      err instanceof MediaProcessingError
    ) {
      return apiErrorResponse(new ApiError(400, err.message));
    }
    return apiErrorResponse(err);
  }
}
