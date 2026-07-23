import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getGateInTenant, archiveGate } from "@/lib/repositories/gate-repository";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("gate", "DELETE");
    const { id } = await params;

    const gate = await getGateInTenant(session.tenantId, id);
    if (!gate) throw new ApiError(404, "Gate not found");

    await archiveGate(session.tenantId, id);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "gate.archived",
      entityType: "Gate",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
