import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/authorize";

export interface SafeTrackerSummary {
  source: string | null;
  freshness: "LIVE" | "FRESH" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
  recordedAt: string | null;
  isSynthetic: boolean;
  mappingState: string | null;
  limitations: string[];
}

export async function trackerSummaries(
  session: AuthenticatedSession,
  vehicleIds: string[],
): Promise<Map<string, SafeTrackerSummary>> {
  const result = new Map<string, SafeTrackerSummary>();
  if (!(await hasPermission(session, "telematics", "VIEW"))) {
    for (const id of vehicleIds)
      result.set(id, {
        source: null,
        freshness: "UNAVAILABLE",
        recordedAt: null,
        isSynthetic: false,
        mappingState: null,
        limitations: [
          "Tracker detail is not available with your current permissions.",
        ],
      });
    return result;
  }
  const [events, mappings] = await Promise.all([
    prisma.telematicsEvent.findMany({
      where: tenantWhere(session.tenantId, { vehicleId: { in: vehicleIds } }),
      orderBy: { recordedAt: "desc" },
      select: {
        vehicleId: true,
        source: true,
        recordedAt: true,
        freshness: true,
        isSynthetic: true,
        mappingState: true,
        processingStatus: true,
        confidenceLimitations: true,
      },
    }),
    prisma.trackerVehicleMapping.findMany({
      where: tenantWhere(session.tenantId, {
        vehicleId: { in: vehicleIds },
        effectiveFrom: { lte: new Date() },
        effectiveTo: null,
      }),
      select: { vehicleId: true, source: true },
    }),
  ]);
  const activeSources = new Map(
    mappings.map((mapping) => [mapping.vehicleId, mapping.source]),
  );
  for (const event of events) {
    if (result.has(event.vehicleId)) continue;
    const freshness =
      event.processingStatus === "ACCEPTED"
        ? event.freshness === "FRESH"
          ? "FRESH"
          : "STALE"
        : "UNAVAILABLE";
    result.set(event.vehicleId, {
      source: activeSources.get(event.vehicleId) ?? event.source,
      freshness,
      recordedAt: event.recordedAt.toISOString(),
      isSynthetic: event.isSynthetic,
      mappingState: event.mappingState,
      limitations: event.confidenceLimitations
        ? [event.confidenceLimitations]
        : [],
    });
  }
  for (const id of vehicleIds)
    if (!result.has(id))
      result.set(id, {
        source: activeSources.get(id) ?? null,
        freshness: "UNAVAILABLE",
        recordedAt: null,
        isSynthetic: false,
        mappingState: activeSources.has(id) ? "MAPPED" : "UNMAPPED",
        limitations: [
          activeSources.has(id)
            ? "No accepted tracker event is available."
            : "No active tracker mapping is available.",
        ],
      });
  return result;
}
