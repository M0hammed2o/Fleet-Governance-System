import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";

/**
 * Resolves the (tenant, user) pair for login. Tenant is identified by slug
 * because User.email is only unique *within* a tenant, not globally — see
 * DATA_MODEL.md. Returns null if the tenant or user doesn't exist; callers
 * must not distinguish "no such tenant" from "no such user" in error
 * messages (avoid tenant-enumeration via login errors).
 *
 * Note: this is a compound-unique lookup (tenantId_email), so it doesn't go
 * through the tenantWhere() list-query helper in lib/db/tenant-scope.ts —
 * tenantId is still the first field of the compound key, so the tenant-scope
 * guarantee holds.
 */
export async function findUserForLogin(tenantSlug: string, email: string) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return null;

  return prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    include: { role: true, tenant: true },
  });
}

export async function findUserByIdInTenant(tenantId: string, userId: string) {
  return prisma.user.findFirst({ where: tenantWhere(tenantId, { id: userId }) });
}

export async function listUsersInTenant(tenantId: string) {
  return prisma.user.findMany({
    where: tenantWhere(tenantId),
    include: {
      role: { include: { rolePermissions: { include: { permission: true } } } },
      assignedSite: { select: { id: true, name: true } },
      assignedGate: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function listPendingInvitationsInTenant(tenantId: string) {
  return prisma.userInvitation.findMany({
    where: tenantWhere(tenantId, { acceptedAt: null, revokedAt: null }),
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
}
