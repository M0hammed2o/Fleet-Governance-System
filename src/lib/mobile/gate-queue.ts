import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { trackerSummaries } from "./tracker-summary";
import type { Prisma } from "@/generated/prisma/client";

export async function getMobileGateQueue(
  session: AuthenticatedSession,
  input: { query?: string; page?: number },
) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = 20;
  const query = input.query?.trim() ?? "";
  const filter: Prisma.MovementAuthorisationWhereInput = {
    status: { in: ["APPROVED", "IN_PROGRESS"] },
    ...(query
      ? {
          OR: [
            {
              referenceCode: { contains: query, mode: "insensitive" as const },
            },
            {
              vehicle: {
                registrationNumber: {
                  contains: query,
                  mode: "insensitive" as const,
                },
              },
            },
            {
              vehicle: {
                fleetNumber: { contains: query, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {}),
  };
  const where = tenantWhere(session.tenantId, filter);
  const [movements, total] = await Promise.all([
    prisma.movementAuthorisation.findMany({
      where,
      orderBy: [{ expectedDepartureAt: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { vehicle: true, driver: true, site: true },
    }),
    prisma.movementAuthorisation.count({ where }),
  ]);
  const trackers = await trackerSummaries(
    session,
    movements.map((movement) => movement.vehicleId),
  );
  return {
    items: movements.map((movement) => ({
      id: movement.id,
      referenceCode: movement.referenceCode,
      status: movement.status,
      direction:
        movement.status === "APPROVED" ? ("ENTRY" as const) : ("EXIT" as const),
      expectedAt:
        (movement.status === "APPROVED"
          ? movement.expectedDepartureAt
          : movement.expectedReturnAt
        )?.toISOString() ?? null,
      vehicle: {
        id: movement.vehicle.id,
        registrationNumber: movement.vehicle.registrationNumber,
        fleetNumber: movement.vehicle.fleetNumber,
      },
      driver: {
        id: movement.driver.id,
        name: movement.driver.name,
        employeeNumber: movement.driver.employeeNumber,
      },
      site: { id: movement.site.id, name: movement.site.name },
      authorization: {
        allowed: true,
        reason:
          movement.status === "APPROVED"
            ? "Approved for departure checks."
            : "In progress and eligible for return checks.",
      },
      tracker: trackers.get(movement.vehicleId)!,
    })),
    total,
    page,
    pageSize,
  };
}
