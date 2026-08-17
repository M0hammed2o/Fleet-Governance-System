import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { inviteUserSchema } from "@/lib/validation/auth";
import { createInvitation } from "@/lib/auth/invitation";
import { recordAudit } from "@/lib/audit/record-audit";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("user", "CREATE");

    const body = await request.json().catch(() => null);
    const parsed = inviteUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { email, name, roleId, employeeNumber, assignedSiteId, assignedGateId } = parsed.data;

    const role = await prisma.role.findFirst({ where: { id: roleId, tenantId: session.tenantId } });
    if (!role) throw new ApiError(400, "That role does not belong to your company.");

    if (assignedSiteId) {
      const site = await prisma.site.findFirst({ where: { id: assignedSiteId, tenantId: session.tenantId, archivedAt: null } });
      if (!site) throw new ApiError(400, "That site does not belong to your company.");
    }
    if (assignedGateId) {
      const gate = await prisma.gate.findFirst({ where: { id: assignedGateId, tenantId: session.tenantId, archivedAt: null } });
      if (!gate || (assignedSiteId && gate.siteId !== assignedSiteId)) throw new ApiError(400, "That gate does not belong to the selected company site.");
    }

    const existing = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: session.tenantId, email } },
    });
    if (existing) throw new ApiError(409, "A user with that email already exists in your company.");

    const invitation = await createInvitation({
      tenantId: session.tenantId,
      invitedById: session.userId,
      roleId,
      email,
      name,
      employeeNumber,
      assignedSiteId: assignedSiteId || undefined,
      assignedGateId: assignedGateId || undefined,
      approvalStatus: role.name === "Gate Security Officer" ? "PENDING" : "NOT_REQUIRED",
    });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "user.invited",
      entityType: "User",
      entityId: invitation.userId,
      afterValue: { roleName: role.name, employeeNumber: employeeNumber || null, approvalRequired: role.name === "Gate Security Officer", assignedSiteId: assignedSiteId || null, assignedGateId: assignedGateId || null },
    });

    // No email provider is selected yet (INTEGRATIONS.md) — the raw token is
    // returned directly so the inviter can hand the link to the invitee.
    // Once an email provider is chosen, this becomes "sent" instead of
    // returned, and the token stops appearing in any API response.
    return NextResponse.json({
      ok: true,
      userId: invitation.userId,
      invitationToken: invitation.token,
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
