import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { currentRetentionMilestone } from "@/lib/retention/deletion-rules";
import { getArchiveTierForBytes } from "@/lib/retention/archive-pricing";
import type { MediaCategory } from "@/generated/prisma/client";

/**
 * Phase 8D platform-admin and customer-admin storage dashboards. Real DB
 * aggregate queries only — same "no static/mock values" discipline as
 * security-dashboard-repository.ts and support-access-repository.ts.
 *
 * Computed as a small, fixed number of *grouped* queries across every
 * tenant at once (`groupBy(by: ["tenantId", ...])`), never one query per
 * tenant in a loop — see KNOWN_BUGS.md BUG-004 (Phase 8A) for exactly the
 * defect this pattern avoids: an unbounded per-tenant query fan-out that
 * saturates the connection pool and produces incorrect/slow results once
 * enough tenants exist.
 */

const PLATFORM_TENANT_SLUG = "platform";
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StorageDashboardRow {
  tenant: { id: string; name: string; slug: string };
  activeVehicleCount: number;
  currentStorageBytes: number;
  storageByCategory: Array<{ category: MediaCategory; totalBytes: number }>;
  /** Bytes uploaded in the last 30 days minus the 30 days before that — an approximation, not a true historical ledger (no storage-usage-snapshot table exists). */
  monthlyStorageGrowthBytes: number;
  evidenceApproachingExpiryCount: number;
  evidenceUnderHoldCount: number;
  openExportRequestCount: number;
  pendingDeletionRequestCount: number;
  archivedBytes: number;
  archiveTierLabel: string;
  estimatedMonthlyArchiveChargeZarExclVat: number | null;
  failedUploadCount: number;
  storageWarnings: string[];
}

function computeWarnings(row: Omit<StorageDashboardRow, "storageWarnings">): string[] {
  const warnings: string[] = [];
  if (row.failedUploadCount > 0) warnings.push(`${row.failedUploadCount} failed upload(s) awaiting cleanup.`);
  if (row.evidenceUnderHoldCount > 0) warnings.push(`${row.evidenceUnderHoldCount} asset(s) under legal/investigation hold.`);
  if (row.pendingDeletionRequestCount > 0) warnings.push(`${row.pendingDeletionRequestCount} deletion request(s) awaiting approval or in recovery.`);
  if (row.evidenceApproachingExpiryCount > 0) warnings.push(`${row.evidenceApproachingExpiryCount} asset(s) approaching their retention expiry within 90 days.`);
  if (row.monthlyStorageGrowthBytes > 0 && row.currentStorageBytes > 0 && row.monthlyStorageGrowthBytes > row.currentStorageBytes * 0.5) {
    warnings.push("Storage grew by more than 50% of its current total in the last 30 days.");
  }
  return warnings;
}

async function computeDashboardRows(tenantFilter?: string): Promise<StorageDashboardRow[]> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { not: PLATFORM_TENANT_SLUG }, ...(tenantFilter ? { id: tenantFilter } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const tenantIds = tenants.map((t) => t.id);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MILLIS_PER_DAY);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * MILLIS_PER_DAY);
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * MILLIS_PER_DAY);

  const [
    vehicleCounts,
    storageByCategory,
    recentUploads,
    priorUploads,
    approachingExpiryAssets,
    holdCounts,
    exportRequestCounts,
    deletionRequestCounts,
    archivedBytesByTenant,
    failedUploadCounts,
  ] = await Promise.all([
    prisma.vehicle.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, archivedAt: null }, _count: { _all: true } }),
    // "Current storage" is live/billable storage only — ACTIVE or
    // PENDING_DELETION (still occupying space), explicitly never DELETED
    // (its binary is actually gone — counting it would overstate real
    // usage) and never ARCHIVED (tracked separately as archivedBytes, so
    // the two stats stay mutually exclusive and don't double-count).
    prisma.mediaAsset.groupBy({ by: ["tenantId", "category"], where: { tenantId: { in: tenantIds }, uploadStatus: "READY", retentionStatus: { in: ["ACTIVE", "PENDING_DELETION"] } }, _sum: { fileSizeBytes: true } }),
    prisma.mediaAsset.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, uploadStatus: "READY", retentionStatus: { in: ["ACTIVE", "PENDING_DELETION"] }, capturedAt: { gte: thirtyDaysAgo } }, _sum: { fileSizeBytes: true } }),
    prisma.mediaAsset.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, uploadStatus: "READY", retentionStatus: { in: ["ACTIVE", "PENDING_DELETION"] }, capturedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }, _sum: { fileSizeBytes: true } }),
    prisma.mediaAsset.findMany({
      where: { tenantId: { in: tenantIds }, retentionStatus: "ACTIVE", scheduledDeletionAt: { not: null, gte: now, lte: ninetyDaysFromNow } },
      select: { tenantId: true, scheduledDeletionAt: true },
    }),
    prisma.mediaAsset.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, OR: [{ legalHold: true }, { investigationHold: true }] }, _count: { _all: true } }),
    prisma.exportRequest.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, status: { in: ["PENDING", "READY"] } }, _count: { _all: true } }),
    prisma.deletionRequest.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, _count: { _all: true } }),
    prisma.mediaAsset.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, retentionStatus: "ARCHIVED" }, _sum: { fileSizeBytes: true } }),
    prisma.mediaAsset.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, uploadStatus: "FAILED" }, _count: { _all: true } }),
  ]);

  const toCountMap = (rows: Array<{ tenantId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.tenantId, r._count._all]));
  const toSumMap = (rows: Array<{ tenantId: string; _sum: { fileSizeBytes: number | null } }>) => new Map(rows.map((r) => [r.tenantId, r._sum.fileSizeBytes ?? 0]));

  const vehicleCountByTenant = toCountMap(vehicleCounts);
  const recentUploadsByTenant = toSumMap(recentUploads);
  const priorUploadsByTenant = toSumMap(priorUploads);
  const holdCountByTenant = toCountMap(holdCounts);
  const exportRequestCountByTenant = toCountMap(exportRequestCounts);
  const deletionRequestCountByTenant = toCountMap(deletionRequestCounts);
  const archivedBytesByTenantMap = toSumMap(archivedBytesByTenant);
  const failedUploadCountByTenant = toCountMap(failedUploadCounts);

  const categoryByTenant = new Map<string, Array<{ category: MediaCategory; totalBytes: number }>>();
  for (const row of storageByCategory) {
    const list = categoryByTenant.get(row.tenantId) ?? [];
    list.push({ category: row.category, totalBytes: row._sum.fileSizeBytes ?? 0 });
    categoryByTenant.set(row.tenantId, list);
  }

  const expiryCountByTenant = new Map<string, number>();
  for (const asset of approachingExpiryAssets) {
    if (currentRetentionMilestone(asset.scheduledDeletionAt!, now) !== null) {
      expiryCountByTenant.set(asset.tenantId, (expiryCountByTenant.get(asset.tenantId) ?? 0) + 1);
    }
  }

  return tenants.map((tenant): StorageDashboardRow => {
    const storageByCategoryForTenant = categoryByTenant.get(tenant.id) ?? [];
    const currentStorageBytes = storageByCategoryForTenant.reduce((sum, c) => sum + c.totalBytes, 0);
    const archivedBytes = archivedBytesByTenantMap.get(tenant.id) ?? 0;
    const archiveTier = getArchiveTierForBytes(archivedBytes);

    const base = {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      activeVehicleCount: vehicleCountByTenant.get(tenant.id) ?? 0,
      currentStorageBytes,
      storageByCategory: storageByCategoryForTenant,
      monthlyStorageGrowthBytes: (recentUploadsByTenant.get(tenant.id) ?? 0) - (priorUploadsByTenant.get(tenant.id) ?? 0),
      evidenceApproachingExpiryCount: expiryCountByTenant.get(tenant.id) ?? 0,
      evidenceUnderHoldCount: holdCountByTenant.get(tenant.id) ?? 0,
      openExportRequestCount: exportRequestCountByTenant.get(tenant.id) ?? 0,
      pendingDeletionRequestCount: deletionRequestCountByTenant.get(tenant.id) ?? 0,
      archivedBytes,
      archiveTierLabel: archiveTier.label,
      estimatedMonthlyArchiveChargeZarExclVat: archiveTier.monthlyPriceZarExclVat,
      failedUploadCount: failedUploadCountByTenant.get(tenant.id) ?? 0,
    };

    return { ...base, storageWarnings: computeWarnings(base) };
  });
}

/** Platform-admin dashboard — every customer tenant. Gated by the existing `platformTenant:VIEW` (same tier as SUPPORT-001's health summary: aggregate counts only, never an individual business record). */
export async function getPlatformStorageDashboard(session: AuthenticatedSession): Promise<StorageDashboardRow[]> {
  await requirePermission(session, "platformTenant", "VIEW");
  return computeDashboardRows();
}

/** Customer-admin dashboard — the caller's own tenant only. The route gates this with `retention:VIEW`. */
export async function getCustomerStorageDashboard(tenantId: string): Promise<StorageDashboardRow | null> {
  const rows = await computeDashboardRows(tenantId);
  return rows[0] ?? null;
}
