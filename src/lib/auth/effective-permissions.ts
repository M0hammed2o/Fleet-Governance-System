import "server-only";
import { prisma } from "@/lib/db/prisma";
import { permissionKey, type PermissionKey } from "@/lib/auth/permissions";
import type { AuthenticatedSession } from "@/lib/auth/session";

export async function listEffectivePermissionKeys(session: AuthenticatedSession): Promise<PermissionKey[]> {
  const now = new Date();
  const [rolePermissions, overrides, delegations] = await Promise.all([
    prisma.rolePermission.findMany({ where: { roleId: session.roleId }, include: { permission: true } }),
    prisma.userPermissionOverride.findMany({ where: { tenantId: session.tenantId, userId: session.userId }, include: { permission: true } }),
    prisma.approvalDelegation.findMany({ where: { tenantId: session.tenantId, delegateId: session.userId, startAt: { lte: now }, expiresAt: { gt: now }, revokedAt: null }, select: { permissionScope: true } }),
  ]);
  const keys = new Set<string>(rolePermissions.map(({ permission }) => permissionKey(permission.resource, permission.action)));
  for (const delegation of delegations) keys.add(delegation.permissionScope);
  for (const override of overrides) {
    const key = permissionKey(override.permission.resource, override.permission.action);
    if (override.effect === "REVOKE") keys.delete(key); else keys.add(key);
  }
  return [...keys].sort() as PermissionKey[];
}
