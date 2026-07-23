import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDriverInTenant, archiveDriver } from "@/lib/repositories/driver-repository";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("driver", "DELETE");
    const { id } = await params;
    const driver = await getDriverInTenant(session.tenantId, id);
    if (!driver) throw new ApiError(404, "Driver not found");

    await archiveDriver(session.tenantId, id);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "driver.archived",
      entityType: "Driver",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
