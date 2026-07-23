import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { listUsersInTenant, listPendingInvitationsInTenant } from "@/lib/repositories/user-repository";

export async function GET() {
  try {
    const session = await requireApiPermission("user", "VIEW");
    const [users, pendingInvitations] = await Promise.all([
      listUsersInTenant(session.tenantId),
      listPendingInvitationsInTenant(session.tenantId),
    ]);

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        roleName: u.role.name,
        lastLoginAt: u.lastLoginAt,
      })),
      pendingInvitations: pendingInvitations.map((inv) => ({
        id: inv.id,
        email: inv.user.email,
        name: inv.user.name,
        expiresAt: inv.expiresAt,
      })),
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
