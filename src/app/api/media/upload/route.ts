import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
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
import { uploadMediaAssetFormSchema } from "@/lib/validation/media";

// Needs real filesystem access (LocalFilesystemStorageProvider) — Node
// runtime, not edge.
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("mediaAsset", "CREATE");

    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart/form-data with a file field");

    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "A file is required");

    const captureMetadataRaw = form.get("captureMetadata");
    let captureMetadata: unknown;
    if (typeof captureMetadataRaw === "string" && captureMetadataRaw.length > 0) {
      try {
        captureMetadata = JSON.parse(captureMetadataRaw);
      } catch {
        throw new ApiError(400, "captureMetadata must be valid JSON");
      }
    }

    const parsed = uploadMediaAssetFormSchema.safeParse({
      ownerType: form.get("ownerType"),
      ownerId: form.get("ownerId"),
      idempotencyKey: form.get("idempotencyKey"),
      checksumSha256: form.get("checksumSha256") || undefined,
      category: form.get("category") || undefined,
      captureMetadata,
    });
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const data = Buffer.from(await file.arrayBuffer());

    const mediaAsset = await uploadMediaAsset({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      ownerType: parsed.data.ownerType,
      ownerId: parsed.data.ownerId,
      fileName: file.name || "upload",
      contentType: file.type || "application/octet-stream",
      data,
      idempotencyKey: parsed.data.idempotencyKey,
      clientChecksumSha256: parsed.data.checksumSha256 ?? null,
      category: parsed.data.category,
      captureMetadata: parsed.data.captureMetadata ?? null,
    });

    return NextResponse.json({ mediaAsset }, { status: 201 });
  } catch (err) {
    if (
      err instanceof InvalidFileTypeError ||
      err instanceof EmptyFileError ||
      err instanceof FileTooLargeError ||
      err instanceof ChecksumMismatchError ||
      err instanceof MediaProcessingError
    ) {
      return apiErrorResponse(new ApiError(400, err.message));
    }
    if (err instanceof MediaOwnerNotFoundError) {
      return apiErrorResponse(new ApiError(404, err.message));
    }
    if (err instanceof IdempotencyKeyConflictError) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    return apiErrorResponse(err);
  }
}
