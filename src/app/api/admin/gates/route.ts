import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listGatesInTenant, createGate } from "@/lib/repositories/gate-repository";
import { createGateSchema } from "@/lib/validation/organisation";
import { recordAudit } from "@/lib/audit/record-audit";

export async function GET() {
  try {
    const session = await requireApiPermission("gate", "VIEW");
    const gates = await listGatesInTenant(session.tenantId);
    return NextResponse.json({ gates });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("gate", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createGateSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const gate = await createGate(session.tenantId, parsed.data);
    if (!gate) throw new ApiError(400, "That site does not belong to your company.");

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "gate.created",
      entityType: "Gate",
      entityId: gate.id,
      afterValue: { name: gate.name, siteId: gate.siteId, direction: gate.direction },
    });

    return NextResponse.json({ gate });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
