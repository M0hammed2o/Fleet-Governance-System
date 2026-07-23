import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";

export async function listSitesInTenant(tenantId: string) {
  return prisma.site.findMany({
    where: tenantWhere(tenantId, { archivedAt: null }),
    orderBy: { name: "asc" },
    include: { gates: { where: { archivedAt: null } } },
  });
}

/** Returns null (not the other tenant's row) when the site belongs to a different tenant. */
export async function getSiteInTenant(tenantId: string, siteId: string) {
  return prisma.site.findFirst({ where: tenantWhere(tenantId, { id: siteId }) });
}

export async function createSite(tenantId: string, data: { name: string; address?: string | null }) {
  return prisma.site.create({ data: { tenantId, name: data.name, address: data.address ?? null } });
}

export async function updateSite(tenantId: string, siteId: string, data: { name?: string; address?: string | null }) {
  // updateMany, not update-by-id, so a cross-tenant id can never match a row to write to.
  const result = await prisma.site.updateMany({ where: tenantWhere(tenantId, { id: siteId }), data });
  return result.count > 0;
}

export async function archiveSite(tenantId: string, siteId: string) {
  const result = await prisma.site.updateMany({
    where: tenantWhere(tenantId, { id: siteId }),
    data: { archivedAt: new Date() },
  });
  return result.count > 0;
}
