import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";

export interface ListVehiclesOptions {
  search?: string;
  operationalStatus?: "OPERATIONAL" | "WORKSHOP_LOCKOUT" | "SECURITY_LOCKOUT" | "DECOMMISSIONED";
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function listVehiclesInTenant(tenantId: string, options: ListVehiclesOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));

  const where = tenantWhere(tenantId, {
    archivedAt: null,
    ...(options.operationalStatus ? { operationalStatus: options.operationalStatus } : {}),
    ...(options.search
      ? {
          OR: [
            { registrationNumber: { contains: options.search, mode: "insensitive" } },
            { fleetNumber: { contains: options.search, mode: "insensitive" } },
            { vin: { contains: options.search, mode: "insensitive" } },
          ],
        }
      : {}),
  } satisfies Prisma.VehicleWhereInput);

  const [items, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      orderBy: { registrationNumber: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { assignedDriver: true, tyrePositionConfig: true },
    }),
    prisma.vehicle.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getVehicleInTenant(tenantId: string, vehicleId: string) {
  return prisma.vehicle.findFirst({
    where: tenantWhere(tenantId, { id: vehicleId }),
    include: { assignedDriver: true, tyrePositionConfig: { include: { positions: true } }, tyres: true, attachedToVehicle: true, attachedAssets: true },
  });
}

export class DuplicateVehicleIdentifierError extends Error {
  field: "registrationNumber" | "vin";
  constructor(field: "registrationNumber" | "vin") {
    super(`A vehicle with that ${field === "vin" ? "VIN" : "registration number"} already exists in your company.`);
    this.name = "DuplicateVehicleIdentifierError";
    this.field = field;
  }
}

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002" &&
    JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target)
  );
}

export async function createVehicle(tenantId: string, data: Omit<Prisma.VehicleUncheckedCreateInput, "tenantId">) {
  try {
    return await prisma.vehicle.create({ data: { ...data, tenantId } });
  } catch (err) {
    // Server-side uniqueness enforcement — the DB unique index is the actual
    // authority (tenantId, registrationNumber) / (tenantId, vin); this just
    // turns the raw constraint violation into a caller-friendly error rather
    // than trusting frontend validation to have caught it.
    if (isUniqueConstraintViolation(err, "registrationNumber")) throw new DuplicateVehicleIdentifierError("registrationNumber");
    if (isUniqueConstraintViolation(err, "vin")) throw new DuplicateVehicleIdentifierError("vin");
    throw err;
  }
}

export async function updateVehicle(tenantId: string, vehicleId: string, data: Prisma.VehicleUncheckedUpdateManyInput) {
  try {
    const result = await prisma.vehicle.updateMany({
      where: tenantWhere(tenantId, { id: vehicleId }),
      data,
    });
    return result.count > 0;
  } catch (err) {
    if (isUniqueConstraintViolation(err, "registrationNumber")) throw new DuplicateVehicleIdentifierError("registrationNumber");
    if (isUniqueConstraintViolation(err, "vin")) throw new DuplicateVehicleIdentifierError("vin");
    throw err;
  }
}

export async function setVehicleOperationalStatus(
  tenantId: string,
  vehicleId: string,
  operationalStatus: "OPERATIONAL" | "WORKSHOP_LOCKOUT" | "SECURITY_LOCKOUT" | "DECOMMISSIONED",
) {
  const result = await prisma.vehicle.updateMany({
    where: tenantWhere(tenantId, { id: vehicleId }),
    data: { operationalStatus },
  });
  return result.count > 0;
}

export async function archiveVehicle(tenantId: string, vehicleId: string) {
  const result = await prisma.vehicle.updateMany({
    where: tenantWhere(tenantId, { id: vehicleId }),
    data: { archivedAt: new Date() },
  });
  return result.count > 0;
}

/** Used by Phase 3+ gate clearance logic (and testable now): is this vehicle allowed a normal clearance? */
export function isVehicleAvailableForMovement(vehicle: { operationalStatus: string; archivedAt: Date | null }): boolean {
  return vehicle.operationalStatus === "OPERATIONAL" && vehicle.archivedAt === null;
}
