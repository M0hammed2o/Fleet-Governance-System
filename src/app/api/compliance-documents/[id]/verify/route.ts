import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getComplianceDocumentInTenant, verifyComplianceDocument } from "@/lib/repositories/compliance-document-repository";
import { verifyComplianceDocumentSchema } from "@/lib/validation/compliance-document";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("complianceDocument", "AUDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = verifyComplianceDocumentSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const document = await getComplianceDocumentInTenant(session.tenantId, id);
    if (!document) throw new ApiError(404, "Document not found");

    await verifyComplianceDocument(session.tenantId, id, session.userId, parsed.data.decision);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "complianceDocument.verification_recorded",
      entityType: "ComplianceDocument",
      entityId: id,
      afterValue: { verificationStatus: parsed.data.decision },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
