import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { getEffectivePricingForTenant } from "@/lib/repositories/tenant-billing-repository";
import { getUtcMonthBounds } from "@/lib/billing/billing-period";

/**
 * Phase 10 (P10D) — deterministic monthly billable-vehicle snapshot.
 *
 * Billable-vehicle rule (documented here as the single source of truth —
 * see BILLING_AND_SUBSCRIPTIONS.md): a vehicle counts as billable for a
 * period if, at snapshot-generation time, `archivedAt IS NULL` AND
 * `operationalStatus != DECOMMISSIONED`. A vehicle temporarily in
 * WORKSHOP_LOCKOUT or SECURITY_LOCKOUT is still billable — it remains a
 * fleet asset the tenant is actively managing through this platform, only
 * DECOMMISSIONED (permanently retired) or archived vehicles are excluded.
 */

export async function countActiveVehiclesForTenant(tenantId: string): Promise<{ vehicleIds: string[]; count: number }> {
  const vehicles = await prisma.vehicle.findMany({
    where: tenantWhere(tenantId, { archivedAt: null, operationalStatus: { not: "DECOMMISSIONED" as const } }),
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return { vehicleIds: vehicles.map((v) => v.id), count: vehicles.length };
}

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002" && JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target);
}

/**
 * `upsert()` is not atomic against a genuinely concurrent caller under
 * Postgres' default READ COMMITTED isolation — two callers can both fail to
 * see each other's yet-uncommitted INSERT and both attempt to create,
 * producing a real unique-constraint violation rather than one of them
 * quietly falling back to update. Caught here and resolved by re-fetching
 * the row the other caller just created — the same "lost the race, the
 * winner's row is authoritative" pattern used throughout this file.
 */
async function ensureBillingPeriod(tenantId: string, reference: Date) {
  const { periodStart, periodEnd } = getUtcMonthBounds(reference);
  try {
    return await prisma.billingPeriod.upsert({
      where: { tenantId_periodStart: { tenantId, periodStart } },
      update: {},
      create: { tenantId, periodStart, periodEnd },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "periodStart")) {
      return prisma.billingPeriod.findUniqueOrThrow({ where: { tenantId_periodStart: { tenantId, periodStart } } });
    }
    throw err;
  }
}

/**
 * Idempotent: calling this twice for the same tenant+period (including
 * concurrently) always returns the same snapshot row, never creates a
 * second one — the hard guarantee is the DB-level unique constraint on
 * `BillableVehicleSnapshot.billingPeriodId` (itself unique per
 * tenant+periodStart via `BillingPeriod`), not just a check-then-create
 * race.
 */
export async function generateBillableVehicleSnapshot(tenantId: string, reference: Date, actorUserId: string | null) {
  const billingPeriod = await ensureBillingPeriod(tenantId, reference);

  const existing = await prisma.billableVehicleSnapshot.findUnique({ where: { billingPeriodId: billingPeriod.id } });
  if (existing) return existing;

  const { vehicleIds, count } = await countActiveVehiclesForTenant(tenantId);
  const pricing = await getEffectivePricingForTenant(tenantId, billingPeriod.periodStart);

  try {
    const snapshot = await prisma.$transaction(async (tx) => {
      const created = await tx.billableVehicleSnapshot.create({
        data: {
          tenantId,
          billingPeriodId: billingPeriod.id,
          vehicleIds,
          vehicleCount: count,
          baseFeeMinorUnitsApplied: pricing.baseFeeMinorUnits,
          perVehicleFeeMinorUnitsApplied: pricing.perVehicleFeeMinorUnits,
          currency: pricing.currency,
          generatedByUserId: actorUserId,
        },
      });
      await tx.billingPeriod.update({ where: { id: billingPeriod.id }, data: { status: "SNAPSHOTTED" } });
      return created;
    });

    await recordAudit({
      tenantId,
      userId: actorUserId,
      action: "billing.vehicleSnapshotGenerated",
      entityType: "BillableVehicleSnapshot",
      entityId: snapshot.id,
      afterValue: { vehicleCount: snapshot.vehicleCount, baseFeeMinorUnitsApplied: snapshot.baseFeeMinorUnitsApplied, perVehicleFeeMinorUnitsApplied: snapshot.perVehicleFeeMinorUnitsApplied, pricingSource: pricing.source },
    });

    return snapshot;
  } catch (err) {
    if (isUniqueConstraintViolation(err, "billingPeriodId")) {
      // Lost a genuine concurrent race to another caller — its snapshot is
      // authoritative, return it rather than erroring.
      return prisma.billableVehicleSnapshot.findUniqueOrThrow({ where: { billingPeriodId: billingPeriod.id } });
    }
    throw err;
  }
}

export async function getBillableVehicleSnapshotForPeriod(tenantId: string, reference: Date) {
  const { periodStart } = getUtcMonthBounds(reference);
  const billingPeriod = await prisma.billingPeriod.findUnique({ where: { tenantId_periodStart: { tenantId, periodStart } }, include: { billableVehicleSnapshot: true } });
  return billingPeriod?.billableVehicleSnapshot ?? null;
}
