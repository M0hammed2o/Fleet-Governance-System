import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listExpiryRulesInTenant, upsertExpiryRule } from "@/lib/repositories/document-expiry-rule-repository";
import { upsertExpiryRuleSchema } from "@/lib/validation/compliance-document";
import { recordAudit } from "@/lib/audit/record-audit";

// Tenant-wide policy, not a per-document action — gated on tenant:CONFIGURE
// (Company Administrator only), not complianceDocument:* (which Fleet
// Manager also holds for day-to-day document records).
export async function GET() {
  try {
    const session = await requireApiPermission("tenant", "CONFIGURE");
    const rules = await listExpiryRulesInTenant(session.tenantId);
    return NextResponse.json({ rules });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireApiPermission("tenant", "CONFIGURE");
    const body = await request.json().catch(() => null);
    const parsed = upsertExpiryRuleSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const rule = await upsertExpiryRule(session.tenantId, parsed.data.documentType, parsed.data.action);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "documentExpiryRule.updated",
      entityType: "DocumentExpiryRule",
      entityId: rule.id,
      afterValue: { documentType: rule.documentType, action: rule.action },
    });

    return NextResponse.json({ rule });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
