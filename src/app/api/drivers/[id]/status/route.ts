import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDriverInTenant, setDriverStatus } from "@/lib/repositories/driver-repository";
import { driverStatusSchema } from "@/lib/validation/driver";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("driver", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = driverStatusSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const before = await getDriverInTenant(session.tenantId, id);
    if (!before) throw new ApiError(404, "Driver not found");

    await setDriverStatus(session.tenantId, id, parsed.data.status);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "driver.status_changed",
      entityType: "Driver",
      entityId: id,
      beforeValue: { status: before.status },
      afterValue: { status: parsed.data.status },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
