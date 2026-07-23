import "server-only";
import { prisma } from "@/lib/db/prisma";
import { permissionKey, type PermissionAction, type PermissionResource } from "@/lib/auth/permissions";
import type { AuthenticatedSession } from "@/lib/auth/session";

export class ForbiddenError extends Error {
  constructor(resource: string, action: string) {
    super(`Forbidden: missing permission ${permissionKey(resource, action)}`);
    this.name = "ForbiddenError";
  }
}

/**
 * Evaluates whether `session`'s user may perform `action` on `resource`.
 * Precedence (most to least authoritative):
 *   1. An explicit per-user REVOKE override — always wins, even over role or delegation.
 *   2. An explicit per-user GRANT override.
 *   3. The user's role having the permission.
 *   4. An active (started, not expired, not revoked) approval delegation whose
 *      scope matches resource:action, delegated *to* this user.
 *
 * Every query here is implicitly tenant-scoped via session.tenantId /
 * session.userId — this function must never be passed a resource id from a
 * different tenant and trusted; callers are responsible for tenant-scoping
 * the underlying data query separately (see lib/db/tenant-scope.ts).
 */
export async function hasPermission(
  session: AuthenticatedSession,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<boolean> {
  const permission = await prisma.permission.findUnique({
    where: { resource_action: { resource, action } },
  });
  if (!permission) return false;

  const override = await prisma.userPermissionOverride.findUnique({
    where: { userId_permissionId: { userId: session.userId, permissionId: permission.id } },
  });
  if (override?.effect === "REVOKE") return false;
  if (override?.effect === "GRANT") return true;

  const rolePermission = await prisma.rolePermission.findUnique({
    where: { roleId_permissionId: { roleId: session.roleId, permissionId: permission.id } },
  });
  if (rolePermission) return true;

  const scope = permissionKey(resource, action);
  const now = new Date();
  const activeDelegation = await prisma.approvalDelegation.findFirst({
    where: {
      tenantId: session.tenantId,
      delegateId: session.userId,
      permissionScope: scope,
      startAt: { lte: now },
      expiresAt: { gt: now },
      revokedAt: null,
    },
  });

  return activeDelegation != null;
}

/** Throws ForbiddenError if the session lacks the permission. Use at the top of every mutating/sensitive code path. */
export async function requirePermission(
  session: AuthenticatedSession,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<void> {
  const allowed = await hasPermission(session, resource, action);
  if (!allowed) {
    throw new ForbiddenError(resource, action);
  }
}
