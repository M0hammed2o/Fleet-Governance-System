import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  requireMobilePermission,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { uploadMediaAssetFormSchema } from "@/lib/validation/media";
import {
  uploadMediaAsset,
  InvalidFileTypeError,
  EmptyFileError,
  FileTooLargeError,
  ChecksumMismatchError,
  IdempotencyKeyConflictError,
  MediaOwnerNotFoundError,
  MediaProcessingError,
} from "@/lib/repositories/media-asset-repository";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const session = await requireMobilePermission(
      request,
      "mediaAsset",
      "CREATE",
    );
    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart evidence data.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "A file is required.");
    const parsed = uploadMediaAssetFormSchema.safeParse({
      ownerType: form.get("ownerType"),
      ownerId: form.get("ownerId"),
      idempotencyKey: form.get("idempotencyKey"),
      checksumSha256: form.get("checksumSha256") || undefined,
      category: form.get("category") || undefined,
      captureMetadata: {
        source: "mobile",
        synthetic: process.env.PILOT_MODE === "true",
        gpsIncluded: false,
      },
    });
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid evidence metadata.",
      );
    const mediaAsset = await uploadMediaAsset({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      ownerType: parsed.data.ownerType,
      ownerId: parsed.data.ownerId,
      fileName: file.name || "evidence",
      contentType: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
      idempotencyKey: parsed.data.idempotencyKey,
      clientChecksumSha256: parsed.data.checksumSha256 ?? null,
      category: parsed.data.category,
      captureMetadata: parsed.data.captureMetadata ?? null,
    });
    return NextResponse.json(
      {
        mediaAsset: {
          id: mediaAsset.id,
          ownerType: mediaAsset.ownerType,
          ownerId: mediaAsset.ownerId,
          contentType: mediaAsset.contentType,
          fileSizeBytes: mediaAsset.fileSizeBytes,
          uploadStatus: mediaAsset.uploadStatus,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof InvalidFileTypeError ||
      error instanceof EmptyFileError ||
      error instanceof FileTooLargeError ||
      error instanceof ChecksumMismatchError ||
      error instanceof MediaProcessingError
    )
      return mobileApiErrorResponse(new ApiError(400, error.message));
    if (error instanceof MediaOwnerNotFoundError)
      return mobileApiErrorResponse(new ApiError(404, error.message));
    if (error instanceof IdempotencyKeyConflictError)
      return mobileApiErrorResponse(new ApiError(409, error.message));
    return mobileApiErrorResponse(error);
  }
}
