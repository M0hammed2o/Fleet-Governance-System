import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { VehicleCategory } from "@/generated/prisma/client";

export async function listTyrePositionConfigsInTenant(tenantId: string) {
  return prisma.tyrePositionConfig.findMany({
    where: tenantWhere(tenantId),
    orderBy: { name: "asc" },
    include: { positions: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function getTyrePositionConfigInTenant(tenantId: string, configId: string) {
  return prisma.tyrePositionConfig.findFirst({
    where: tenantWhere(tenantId, { id: configId }),
    include: { positions: { orderBy: { sortOrder: "asc" } } },
  });
}

export interface CreateTyrePositionConfigInput {
  tenantId: string;
  name: string;
  category: VehicleCategory;
  positions: { code: string; label: string }[];
}

// P11-000 (DECISIONS.md D-038): positions are created via a separate,
// explicit createMany() rather than a nested `positions: { create: [...] }`
// write — see the same pattern's rationale in invoice-repository.ts.
export async function createTyrePositionConfig(input: CreateTyrePositionConfigInput) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.tyrePositionConfig.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        category: input.category,
        isSystem: false,
      },
    });
    await tx.tyrePositionDefinition.createMany({
      data: input.positions.map((p, index) => ({ configId: created.id, code: p.code, label: p.label, sortOrder: index })),
    });
    return tx.tyrePositionConfig.findUniqueOrThrow({ where: { id: created.id }, include: { positions: true } });
  });
}

export async function upsertVehicleTyre(
  tenantId: string,
  vehicleId: string,
  positionDefinitionId: string,
  data: { brand?: string | null; size?: string | null; notes?: string | null },
) {
  // Confirm both belong to this tenant before writing — vehicleId/positionDefinitionId
  // are caller-supplied ids, not derived from a trusted session.
  const [vehicle, position] = await Promise.all([
    prisma.vehicle.findFirst({ where: tenantWhere(tenantId, { id: vehicleId }) }),
    prisma.tyrePositionDefinition.findFirst({ where: { id: positionDefinitionId, config: { tenantId } } }),
  ]);
  if (!vehicle || !position) return null;

  return prisma.vehicleTyre.upsert({
    where: { vehicleId_positionDefinitionId: { vehicleId, positionDefinitionId } },
    update: data,
    create: { tenantId, vehicleId, positionDefinitionId, ...data },
  });
}
