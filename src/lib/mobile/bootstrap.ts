import "server-only";
import { prisma } from "@/lib/db/prisma";
import { listSitesInTenant } from "@/lib/repositories/site-repository";
import { listEffectivePermissionKeys } from "@/lib/auth/effective-permissions";
import type { AuthenticatedSession } from "@/lib/auth/session";

export async function createMobileBootstrap(session: AuthenticatedSession) {
  const [user, sessionRecord, permissions] = await Promise.all([
    prisma.user.findFirstOrThrow({
      where: { id: session.userId, tenantId: session.tenantId },
      include: { tenant: true },
    }),
    prisma.session.findFirstOrThrow({
      where: {
        id: session.sessionId,
        tenantId: session.tenantId,
        userId: session.userId,
      },
      select: { expiresAt: true },
    }),
    listEffectivePermissionKeys(session),
  ]);
  const permissionSet = new Set<string>(permissions);
  const canSeeSites =
    permissionSet.has("site:VIEW") ||
    permissionSet.has("gate:VIEW") ||
    permissionSet.has("gateEvent:VIEW");
  const sites = canSeeSites ? await listSitesInTenant(session.tenantId) : [];
  return {
    principal: {
      userId: user.id,
      name: user.name,
      roleName: session.roleName,
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
      },
      permissions,
      sessionExpiresAt: sessionRecord.expiresAt.toISOString(),
    },
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      gates: site.gates.map((gate) => ({
        id: gate.id,
        name: gate.name,
        direction: gate.direction,
      })),
    })),
    capabilities: {
      guard:
        permissionSet.has("gateEvent:VIEW") &&
        permissionSet.has("gateEvent:CREATE") &&
        permissionSet.has("gateEvent:EDIT"),
      ownerOverview:
        permissionSet.has("governanceAnalytics:VIEW") ||
        permissionSet.has("movement:APPROVE"),
      approvals:
        permissionSet.has("movement:APPROVE") ||
        permissionSet.has("exception:APPROVE") ||
        permissionSet.has("reconciliation:APPROVE") ||
        permissionSet.has("investigationFinding:APPROVE"),
      investigations: permissionSet.has("investigationCase:VIEW"),
      confidentialInvestigations:
        permissionSet.has("investigationCase:VIEW") &&
        permissionSet.has("investigationConfidentialAccess:VIEW"),
    },
    environment: {
      appEnv: process.env.APP_ENV ?? "development",
      syntheticOnly:
        process.env.APP_ENV !== "production" &&
        process.env.PILOT_MODE === "true",
      pushEnabled: false as const,
      offlineMutations: false as const,
    },
  };
}
