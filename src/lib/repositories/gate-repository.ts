import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";

export async function listGatesInTenant(tenantId: string) {
  return prisma.gate.findMany({
    where: tenantWhere(tenantId, { archivedAt: null }),
    orderBy: { name: "asc" },
    include: { site: true },
  });
}

export async function getGateInTenant(tenantId: string, gateId: string) {
  return prisma.gate.findFirst({ where: tenantWhere(tenantId, { id: gateId }) });
}

export async function createGate(
  tenantId: string,
  data: { siteId: string; name: string; direction?: "ENTRY" | "EXIT" | "BOTH" },
) {
  // Verify the site is actually this tenant's before attaching a gate to it —
  // otherwise a caller could create a gate under another tenant's site id.
  const site = await prisma.site.findFirst({ where: tenantWhere(tenantId, { id: data.siteId }) });
  if (!site) return null;

  return prisma.gate.create({
    data: { tenantId, siteId: data.siteId, name: data.name, direction: data.direction ?? "BOTH" },
  });
}

export async function updateGate(
  tenantId: string,
  gateId: string,
  data: { name?: string; direction?: "ENTRY" | "EXIT" | "BOTH" },
) {
  const result = await prisma.gate.updateMany({ where: tenantWhere(tenantId, { id: gateId }), data });
  return result.count > 0;
}

export async function archiveGate(tenantId: string, gateId: string) {
  const result = await prisma.gate.updateMany({
    where: tenantWhere(tenantId, { id: gateId }),
    data: { archivedAt: new Date() },
  });
  return result.count > 0;
}
