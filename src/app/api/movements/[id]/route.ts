import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getMovementInTenant } from "@/lib/repositories/movement-repository";
import { listMediaAssetsForOwner } from "@/lib/repositories/media-asset-repository";
import { hasPermission } from "@/lib/auth/authorize";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("movement", "VIEW");
    const { id } = await params;
    const movement = await getMovementInTenant(session.tenantId, id);
    if (!movement) throw new ApiError(404, "Movement not found");

    // Delivery-note/supporting documents (DISPATCH-003) — omitted entirely
    // for a role with no mediaAsset:VIEW at all (e.g. Executive Read-Only
    // Viewer), same evidence-visibility boundary every other media surface
    // in this app already respects.
    const documents = (await hasPermission(session, "mediaAsset", "VIEW"))
      ? await listMediaAssetsForOwner(session.tenantId, "MOVEMENT_DOCUMENT", id)
      : [];

    return NextResponse.json({ movement, documents });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
