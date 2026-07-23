import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  attachAttachmentToComplianceDocument,
  EvidenceMediaAssetNotFoundError,
} from "@/lib/repositories/compliance-document-repository";
import { attachComplianceDocumentAttachmentSchema } from "@/lib/validation/compliance-document";
import { recordAudit } from "@/lib/audit/record-audit";

/**
 * Links a previously uploaded MediaAsset (POST /api/media/upload,
 * ownerType=COMPLIANCE_DOCUMENT, ownerId=this document's id) to an existing
 * compliance document — a separate step from creation, since the
 * MediaAsset's owner-existence check needs the document id to already exist.
 * See DECISIONS.md D-012.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("complianceDocument", "EDIT");
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = attachComplianceDocumentAttachmentSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const updated = await attachAttachmentToComplianceDocument(session.tenantId, id, parsed.data.attachmentMediaAssetId);
    if (!updated) throw new ApiError(404, "Compliance document not found");

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "complianceDocument.attachmentLinked",
      entityType: "ComplianceDocument",
      entityId: id,
      afterValue: { attachmentMediaAssetId: parsed.data.attachmentMediaAssetId },
    });

    return NextResponse.json({ document: updated });
  } catch (err) {
    if (err instanceof EvidenceMediaAssetNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
