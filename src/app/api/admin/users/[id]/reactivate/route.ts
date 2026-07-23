import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { findUserByIdInTenant } from "@/lib/repositories/user-repository";
import { recordAudit } from "@/lib/audit/record-audit";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("user", "EDIT");
    const { id } = await params;

    const target = await findUserByIdInTenant(session.tenantId, id);
    if (!target) throw new ApiError(404, "User not found");
    if (target.status !== "SUSPENDED") {
      throw new ApiError(409, `Only suspended users can be reactivated (current status: ${target.status}).`);
    }

    await prisma.user.update({ where: { id: target.id }, data: { status: "ACTIVE" } });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "user.reactivated",
      entityType: "User",
      entityId: target.id,
      beforeValue: { status: "SUSPENDED" },
      afterValue: { status: "ACTIVE" },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
