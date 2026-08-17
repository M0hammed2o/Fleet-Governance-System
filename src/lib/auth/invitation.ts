import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface CreateInvitationInput {
  tenantId: string;
  invitedById: string;
  roleId: string;
  email: string;
  name: string;
  employeeNumber?: string;
  assignedSiteId?: string;
  assignedGateId?: string;
  approvalStatus?: "NOT_REQUIRED" | "PENDING";
}

export interface CreateInvitationResult {
  userId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Creates the User row (status INVITED, no password yet) and its invitation
 * token in one transaction. Returns the raw token — callers must place it in
 * an invite link. No email provider is selected yet (INTEGRATIONS.md), so the
 * caller is currently the invite API response itself; swapping in real email
 * delivery later doesn't change this function's contract.
 */
export async function createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        tenantId: input.tenantId,
        roleId: input.roleId,
        email: input.email,
        name: input.name,
        passwordHash: null,
        status: "INVITED",
        employeeNumber: input.employeeNumber || null,
        assignedSiteId: input.assignedSiteId || null,
        assignedGateId: input.assignedGateId || null,
        approvalStatus: input.approvalStatus ?? "NOT_REQUIRED",
      },
    });
    await tx.userInvitation.create({
      data: {
        tenantId: input.tenantId,
        userId: created.id,
        tokenHash,
        invitedById: input.invitedById,
        expiresAt,
      },
    });
    return created;
  });

  return { userId: user.id, token, expiresAt };
}

export type InvitationValidationFailure =
  | "not_found"
  | "already_accepted"
  | "revoked"
  | "expired"
  | "tenant_inactive";

export interface ValidInvitation {
  invitationId: string;
  userId: string;
  tenantId: string;
}

/**
 * Looks up an invitation by its raw token and checks it's still usable,
 * including that its tenant hasn't been suspended since the invite was sent —
 * accepting must not be a backdoor around a Platform Administrator's
 * suspension of the tenant (see login-eligibility.ts for the equivalent
 * login-time check).
 */
export async function validateInvitationToken(
  token: string,
): Promise<{ ok: true; invitation: ValidInvitation } | { ok: false; reason: InvitationValidationFailure }> {
  const tokenHash = hashToken(token);
  const invitation = await prisma.userInvitation.findUnique({ where: { tokenHash }, include: { tenant: true } });

  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.revokedAt) return { ok: false, reason: "revoked" };
  if (invitation.acceptedAt) return { ok: false, reason: "already_accepted" };
  if (invitation.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (invitation.tenant.status !== "ACTIVE") return { ok: false, reason: "tenant_inactive" };

  return {
    ok: true,
    invitation: { invitationId: invitation.id, userId: invitation.userId, tenantId: invitation.tenantId },
  };
}

export async function markInvitationAccepted(invitationId: string): Promise<void> {
  await prisma.userInvitation.update({
    where: { id: invitationId },
    data: { acceptedAt: new Date() },
  });
}
