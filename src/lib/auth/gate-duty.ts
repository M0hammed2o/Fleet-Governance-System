import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { AuthenticatedSession } from "@/lib/auth/session";

export function staffApprovalDecisionError(input: { actorUserId: string; targetUserId: string; targetRoleName: string }): string | null {
  if (input.actorUserId === input.targetUserId) return "Staff members cannot approve their own gate access.";
  if (input.targetRoleName !== "Gate Security Officer") return "Approval is only required for gate security officers.";
  return null;
}

export async function gateDutyApprovalError(session: AuthenticatedSession, gateId?: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { id: session.userId, tenantId: session.tenantId },
    include: { role: { select: { name: true } } },
  });
  if (!user) return "The staff account is unavailable.";
  if (user.role.name !== "Gate Security Officer") return null;
  if (user.approvalStatus !== "APPROVED") return "Security guards must be independently approved before performing gate duties.";
  if (gateId && user.assignedGateId && user.assignedGateId !== gateId) return "This guard is assigned to a different gate.";
  if (gateId && user.assignedSiteId) {
    const gate = await prisma.gate.findFirst({ where: { id: gateId, tenantId: session.tenantId }, select: { siteId: true } });
    if (!gate || gate.siteId !== user.assignedSiteId) return "This guard is assigned to a different site.";
  }
  return null;
}
