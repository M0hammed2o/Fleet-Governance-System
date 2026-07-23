import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";

/**
 * The ONLY code path that lets a Platform Administrator touch data outside
 * their own "platform" tenant. Deliberately narrow: it can list/create
 * tenants and flip a tenant's ACTIVE/SUSPENDED status — it exposes nothing
 * about a tenant's *business* data (no sites, users, drivers, vehicles, gate
 * events, ...). "Cannot silently access tenant evidence" (build brief 6) is
 * enforced two ways here, not just by convention:
 *   1. Every function requires the `platformTenant` permission explicitly —
 *      ordinary tenant roles are never granted it (see prisma/seed.ts).
 *   2. Every function writes an audit row before returning, scoped to the
 *      platform admin's own tenant, so "who looked at/changed which tenant
 *      and when" is always reconstructable. There is no silent variant.
 *
 * If a future support-access feature needs to read a customer tenant's
 * business data, it must be a new, separately-scoped, similarly audited
 * mechanism — not an extension of this file. See TODO.md "break-glass".
 */

export async function listAllTenantsAsPlatformAdmin(session: AuthenticatedSession) {
  await requirePermission(session, "platformTenant", "VIEW");

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true, status: true, createdAt: true },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platform.tenant.list",
    entityType: "Tenant",
    entityId: "ALL",
  });

  return tenants;
}

export async function createTenantAsPlatformAdmin(
  session: AuthenticatedSession,
  data: { name: string; slug: string },
) {
  await requirePermission(session, "platformTenant", "CREATE");

  const tenant = await prisma.tenant.create({ data: { name: data.name, slug: data.slug } });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platform.tenant.created",
    entityType: "Tenant",
    entityId: tenant.id,
    afterValue: { name: tenant.name, slug: tenant.slug },
  });

  return tenant;
}

export async function setTenantStatusAsPlatformAdmin(
  session: AuthenticatedSession,
  tenantId: string,
  status: "ACTIVE" | "SUSPENDED",
) {
  await requirePermission(session, "platformTenant", "CONFIGURE");

  const before = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  const tenant = await prisma.tenant.update({ where: { id: tenantId }, data: { status } });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platform.tenant.status_changed",
    entityType: "Tenant",
    entityId: tenantId,
    beforeValue: { status: before?.status },
    afterValue: { status },
  });

  return tenant;
}
