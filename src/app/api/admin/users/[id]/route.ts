import { z } from "zod";
import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record-audit";

const updateSchema = z.object({
  employeeNumber: z.string().trim().max(100).nullable().optional(),
  assignedSiteId: z.string().trim().min(1).max(200).nullable().optional(),
  assignedGateId: z.string().trim().min(1).max(200).nullable().optional(),
  profileMediaAssetId: z.string().trim().min(1).max(200).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("user", "EDIT");
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid staff update");
    const { id } = await params;
    const before = await prisma.user.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!before) throw new ApiError(404, "Staff member not found");
    if (parsed.data.assignedSiteId) {
      const site = await prisma.site.findFirst({ where: { id: parsed.data.assignedSiteId, tenantId: session.tenantId, archivedAt: null } });
      if (!site) throw new ApiError(400, "That site does not belong to this company.");
    }
    if (parsed.data.assignedGateId) {
      const gate = await prisma.gate.findFirst({ where: { id: parsed.data.assignedGateId, tenantId: session.tenantId, archivedAt: null } });
      if (!gate || (parsed.data.assignedSiteId && gate.siteId !== parsed.data.assignedSiteId)) throw new ApiError(400, "That gate does not belong to the selected site.");
    }
    if (parsed.data.profileMediaAssetId) {
      const asset = await prisma.mediaAsset.findFirst({ where: { id: parsed.data.profileMediaAssetId, tenantId: session.tenantId, ownerType: "STAFF_PROFILE", ownerId: id, binaryDeletedAt: null } });
      if (!asset) throw new ApiError(404, "That private image does not belong to this staff member.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: parsed.data });
      await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: "staff.updated", entityType: "User", entityId: id, beforeValue: { employeeNumber: before.employeeNumber, assignedSiteId: before.assignedSiteId, assignedGateId: before.assignedGateId, profileMediaAssetId: before.profileMediaAssetId }, afterValue: parsed.data }, tx);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
