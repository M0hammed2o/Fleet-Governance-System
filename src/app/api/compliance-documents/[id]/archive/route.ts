import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getComplianceDocumentInTenant, archiveComplianceDocument } from "@/lib/repositories/compliance-document-repository";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("complianceDocument", "DELETE");
    const { id } = await params;
    const document = await getComplianceDocumentInTenant(session.tenantId, id);
    if (!document) throw new ApiError(404, "Document not found");

    await archiveComplianceDocument(session.tenantId, id);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "complianceDocument.archived",
      entityType: "ComplianceDocument",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
