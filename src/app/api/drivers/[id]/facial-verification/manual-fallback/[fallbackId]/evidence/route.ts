import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  attachEvidenceToManualFallback,
  EvidenceMediaAssetNotFoundError,
} from "@/lib/repositories/facial-verification-repository";
import { attachManualFallbackEvidenceSchema } from "@/lib/validation/driver";

/**
 * Attaches a previously uploaded MediaAsset (POST /api/media/upload,
 * ownerType=MANUAL_FACIAL_VERIFICATION_FALLBACK, ownerId=this fallback's id)
 * to an existing manual-fallback request — a separate step from the request
 * itself, since the MediaAsset's owner-existence check needs the fallback id
 * to already exist. See DECISIONS.md D-012.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; fallbackId: string }> }) {
  try {
    const session = await requireApiPermission("facialVerificationFallback", "CREATE");
    const { fallbackId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = attachManualFallbackEvidenceSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const updated = await attachEvidenceToManualFallback(
      session.tenantId,
      fallbackId,
      session.userId,
      parsed.data.evidenceMediaAssetId,
    );
    if (!updated) throw new ApiError(404, "Manual fallback request not found");

    return NextResponse.json({ fallback: updated });
  } catch (err) {
    if (err instanceof EvidenceMediaAssetNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
