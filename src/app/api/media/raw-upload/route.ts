import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { verifyResourceAccess } from "@/lib/storage/signed-url";
import { LocalFilesystemStorageProvider } from "@/lib/storage/local-filesystem-provider";

// Needs real filesystem access — Node runtime, not edge.
export const runtime = "nodejs";

const localProvider = new LocalFilesystemStorageProvider();

/**
 * The local-dev analogue of a real object-storage vendor's presigned PUT
 * target (Phase 8B) — only reachable via an upload-purpose signed
 * `key`/`expires`/`sig` triple minted by `POST /api/media/presigned-upload`
 * (`purpose: "upload"`, distinct from a read token — see
 * lib/storage/signed-url.ts). Deliberately does **not** require an
 * authenticated session: a real S3/R2 presigned URL doesn't check this
 * app's session cookie either — possession of a validly-signed URL is the
 * authorization, and that URL was only ever minted after an already-checked
 * `mediaAsset:CREATE` permission at initiate time. `confirmPresignedUpload()`
 * verifies the object server-side afterward; nothing here is trusted on its
 * own until that confirmation step runs.
 */
export async function PUT(request: Request) {
  try {
    const url = new URL(request.url);
    const keyEncoded = url.searchParams.get("key");
    const expiresParam = url.searchParams.get("expires");
    const signature = url.searchParams.get("sig");
    if (!keyEncoded || !expiresParam || !signature) {
      throw new ApiError(400, "Missing signed URL parameters (key, expires, sig are all required).");
    }
    const expiresAt = Number(expiresParam);
    if (!Number.isFinite(expiresAt)) throw new ApiError(400, "Malformed expires parameter");

    let storageKey: string;
    try {
      storageKey = Buffer.from(keyEncoded, "base64url").toString("utf8");
    } catch {
      throw new ApiError(400, "Malformed key parameter");
    }

    const verification = verifyResourceAccess(storageKey, expiresAt, signature, "upload");
    if (!verification.valid) {
      throw new ApiError(verification.reason === "expired" ? 410 : 403, verification.reason === "expired" ? "This upload URL has expired." : "This upload URL is invalid.");
    }

    const data = Buffer.from(await request.arrayBuffer());
    if (data.byteLength === 0) throw new ApiError(400, "The uploaded file is empty.");

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    await localProvider.writeObject(storageKey, data, contentType);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
