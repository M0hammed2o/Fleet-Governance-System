import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  serveRawMediaAsset,
  InvalidOrExpiredSignedUrlError,
  MediaAssetNotFoundForStorageKeyError,
} from "@/lib/repositories/media-asset-repository";

// Needs real filesystem access (LocalFilesystemStorageProvider) — Node
// runtime, not edge.
export const runtime = "nodejs";

/**
 * The ONLY route that ever serves raw evidence bytes (EVID-002 / TESTING.md
 * "media cannot be accessed using a public permanent URL"). Only reachable
 * via a signed `key`/`expires`/`sig` triple minted by
 * `GET /api/media/[id]` — there is no other route, and no static/public path
 * (`.data/` is gitignored and never under Next's `/public`), that can serve
 * this content. Still requires an authenticated session on top of a valid
 * signature (defense in depth: a logged-out/revoked session can't use an
 * otherwise-still-valid signed URL either).
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiSession();

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

    const { file } = await serveRawMediaAsset({
      storageKey,
      expiresAt,
      signature,
      requestingTenantId: session.tenantId,
    });

    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=60, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    if (err instanceof InvalidOrExpiredSignedUrlError) {
      return apiErrorResponse(new ApiError(err.reason === "expired" ? 410 : 403, err.message));
    }
    if (err instanceof MediaAssetNotFoundForStorageKeyError) {
      return apiErrorResponse(new ApiError(404, err.message));
    }
    return apiErrorResponse(err);
  }
}
