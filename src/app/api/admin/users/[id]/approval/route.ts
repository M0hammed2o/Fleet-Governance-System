import { z } from "zod";
import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record-audit";
import { staffApprovalDecisionError } from "@/lib/auth/gate-duty";

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("user", "CONFIGURE");
    const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid approval decision");
    const { id } = await params;
    const target = await prisma.user.findFirst({ where: { id, tenantId: session.tenantId }, include: { role: true } });
    if (!target) throw new ApiError(404, "Staff member not found");
    const decisionError = staffApprovalDecisionError({ actorUserId: session.userId, targetUserId: id, targetRoleName: target.role.name });
    if (decisionError) throw new ApiError(id === session.userId ? 409 : 400, decisionError);
    const status = parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { approvalStatus: status, approvalReason: parsed.data.reason, approvedByUserId: session.userId, approvedAt: new Date() } });
      await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: `staff.${status.toLowerCase()}`, entityType: "User", entityId: id, reason: parsed.data.reason, beforeValue: { approvalStatus: target.approvalStatus }, afterValue: { approvalStatus: status } }, tx);
    });
    return NextResponse.json({ ok: true, approvalStatus: status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
