import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";

export interface ListDriversOptions {
  search?: string;
  status?: "ACTIVE" | "SUSPENDED" | "BLACKLISTED";
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function listDriversInTenant(tenantId: string, options: ListDriversOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));

  const where = tenantWhere(tenantId, {
    archivedAt: null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.search
      ? {
          OR: [
            { name: { contains: options.search, mode: "insensitive" } },
            { employeeNumber: { contains: options.search, mode: "insensitive" } },
            { licenceNumber: { contains: options.search, mode: "insensitive" } },
          ],
        }
      : {}),
  } satisfies Prisma.DriverWhereInput);

  const [items, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.driver.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getDriverInTenant(tenantId: string, driverId: string) {
  return prisma.driver.findFirst({ where: tenantWhere(tenantId, { id: driverId }) });
}

export type CreateDriverInput = Omit<Prisma.DriverCreateInput, "tenant"> & { tenantId?: never };

export async function createDriver(tenantId: string, data: Omit<CreateDriverInput, "tenantId">) {
  return prisma.driver.create({ data: { ...data, tenantId } as Prisma.DriverUncheckedCreateInput });
}

export async function updateDriver(tenantId: string, driverId: string, data: Prisma.DriverUpdateInput) {
  const result = await prisma.driver.updateMany({ where: tenantWhere(tenantId, { id: driverId }), data: data as Prisma.DriverUncheckedUpdateManyInput });
  return result.count > 0;
}

export async function setDriverStatus(
  tenantId: string,
  driverId: string,
  status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED",
) {
  const result = await prisma.driver.updateMany({ where: tenantWhere(tenantId, { id: driverId }), data: { status } });
  return result.count > 0;
}

/** Mirrors isVehicleAvailableForMovement in vehicle-repository.ts. */
export function isDriverAvailableForMovement(driver: { status: string; archivedAt: Date | null }): boolean {
  return driver.status === "ACTIVE" && driver.archivedAt === null;
}

export async function archiveDriver(tenantId: string, driverId: string) {
  const result = await prisma.driver.updateMany({
    where: tenantWhere(tenantId, { id: driverId }),
    data: { archivedAt: new Date() },
  });
  return result.count > 0;
}
