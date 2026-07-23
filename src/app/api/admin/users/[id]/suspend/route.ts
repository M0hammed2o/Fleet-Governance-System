import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { findUserByIdInTenant } from "@/lib/repositories/user-repository";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/record-audit";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("user", "EDIT");
    const { id } = await params;

    const target = await findUserByIdInTenant(session.tenantId, id);
    if (!target) throw new ApiError(404, "User not found");
    if (target.status !== "ACTIVE") {
      throw new ApiError(409, `Only active users can be suspended (current status: ${target.status}).`);
    }

    await prisma.user.update({ where: { id: target.id }, data: { status: "SUSPENDED" } });
    await revokeAllSessionsForUser(target.id);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "user.suspended",
      entityType: "User",
      entityId: target.id,
      beforeValue: { status: "ACTIVE" },
      afterValue: { status: "SUSPENDED" },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
