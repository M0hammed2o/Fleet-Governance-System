import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { TrackerMappingSource } from "@/generated/prisma/client";

export class TrackerMappingConflictError extends Error {
  constructor(message: string) { super(message); this.name = "TrackerMappingConflictError"; }
}

export class TrackerMappingNotFoundError extends Error {
  constructor() { super("Tracker mapping not found."); this.name = "TrackerMappingNotFoundError"; }
}

export class SyntheticMappingProductionError extends Error {
  constructor() { super("Synthetic tracker mappings are forbidden in production."); this.name = "SyntheticMappingProductionError"; }
}

export interface CreateTrackerMappingInput {
  session: AuthenticatedSession;
  vehicleId: string;
  providerId: string;
  providerAssetId: string;
  source: TrackerMappingSource;
  effectiveFrom: Date;
  reason: string;
  correctionOfId?: string;
}

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

export async function createTrackerMapping(input: CreateTrackerMappingInput) {
  await requirePermission(input.session, "telematics", "CONFIGURE");
  if (input.source === "SYNTHETIC" && (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production")) throw new SyntheticMappingProductionError();
  const providerId = input.providerId.trim().toLowerCase();
  const providerAssetId = input.providerAssetId.trim();
  if (!providerId || !providerAssetId) throw new TrackerMappingConflictError("Provider and tracker asset identifiers are required.");

  try {
    return await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findFirst({ where: { tenantId: input.session.tenantId, id: input.vehicleId }, select: { id: true } });
      if (!vehicle) throw new TrackerMappingNotFoundError();
      const actor = await tx.user.findFirst({ where: { tenantId: input.session.tenantId, id: input.session.userId }, select: { id: true } });
      if (!actor) throw new TrackerMappingNotFoundError();

      const [vehicleConflict, assetConflict] = await Promise.all([
        tx.trackerVehicleMapping.findFirst({ where: { tenantId: input.session.tenantId, vehicleId: input.vehicleId, effectiveTo: null }, select: { id: true } }),
        tx.trackerVehicleMapping.findFirst({ where: { tenantId: input.session.tenantId, providerId, providerAssetId, effectiveTo: null }, select: { id: true, vehicleId: true } }),
      ]);
      if (vehicleConflict) throw new TrackerMappingConflictError("The vehicle already has an active tracker mapping; end or correct it first.");
      if (assetConflict) throw new TrackerMappingConflictError("The tracker asset already has an active vehicle mapping in this tenant.");

      if (input.correctionOfId) {
        const corrected = await tx.trackerVehicleMapping.findFirst({ where: { id: input.correctionOfId, tenantId: input.session.tenantId, effectiveTo: { not: null } }, select: { id: true, vehicleId: true, effectiveTo: true } });
        if (!corrected) throw new TrackerMappingConflictError("A correction must reference an ended mapping in the same tenant.");
        if (corrected.vehicleId !== input.vehicleId) throw new TrackerMappingConflictError("A correction must remain attached to the same vehicle history.");
        if (input.effectiveFrom < corrected.effectiveTo!) throw new TrackerMappingConflictError("A corrected mapping cannot start before the prior mapping ended.");
      }

      const mapping = await tx.trackerVehicleMapping.create({ data: {
        tenantId: input.session.tenantId,
        vehicleId: input.vehicleId,
        providerId,
        providerAssetId,
        source: input.source,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason.trim(),
        createdByUserId: input.session.userId,
        correctionOfId: input.correctionOfId ?? null,
      } });
      await tx.vehicle.update({ where: { id: input.vehicleId }, data: { gpsProvider: providerId, gpsDeviceReference: providerAssetId, gpsStatus: "UNKNOWN" } });
      await recordAudit({
        tenantId: input.session.tenantId,
        userId: input.session.userId,
        action: input.correctionOfId ? "trackerMapping.corrected" : "trackerMapping.created",
        entityType: "TrackerVehicleMapping",
        entityId: mapping.id,
        afterValue: { vehicleId: input.vehicleId, providerId, providerAssetFingerprint: fingerprint(providerAssetId), source: input.source, effectiveFrom: input.effectiveFrom.toISOString(), correctionOfId: input.correctionOfId ?? null },
        reason: input.reason.trim(),
      }, tx);
      return mapping;
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new TrackerMappingConflictError("An active tracker mapping conflict was detected.");
    throw error;
  }
}

export async function endTrackerMapping(input: { session: AuthenticatedSession; vehicleId: string; mappingId: string; effectiveTo: Date; reason: string }) {
  await requirePermission(input.session, "telematics", "CONFIGURE");
  return prisma.$transaction(async (tx) => {
    const mapping = await tx.trackerVehicleMapping.findFirst({ where: { tenantId: input.session.tenantId, vehicleId: input.vehicleId, id: input.mappingId, effectiveTo: null } });
    if (!mapping) throw new TrackerMappingNotFoundError();
    if (input.effectiveTo < mapping.effectiveFrom) throw new TrackerMappingConflictError("Mapping end time cannot precede its start time.");
    const ended = await tx.trackerVehicleMapping.update({ where: { id: mapping.id }, data: { effectiveTo: input.effectiveTo, endedByUserId: input.session.userId } });
    await tx.vehicle.updateMany({ where: { tenantId: input.session.tenantId, id: mapping.vehicleId, gpsProvider: mapping.providerId, gpsDeviceReference: mapping.providerAssetId }, data: { gpsProvider: null, gpsDeviceReference: null, gpsStatus: "UNKNOWN" } });
    await recordAudit({
      tenantId: input.session.tenantId,
      userId: input.session.userId,
      action: "trackerMapping.ended",
      entityType: "TrackerVehicleMapping",
      entityId: mapping.id,
      beforeValue: { effectiveTo: null },
      afterValue: { effectiveTo: input.effectiveTo.toISOString(), providerAssetFingerprint: fingerprint(mapping.providerAssetId) },
      reason: input.reason.trim(),
    }, tx);
    return ended;
  });
}

export async function listTrackerMappingHistory(session: AuthenticatedSession, vehicleId: string) {
  await requirePermission(session, "telematics", "VIEW");
  const vehicle = await prisma.vehicle.findFirst({ where: { tenantId: session.tenantId, id: vehicleId }, select: { id: true } });
  if (!vehicle) throw new TrackerMappingNotFoundError();
  const mappings = await prisma.trackerVehicleMapping.findMany({ where: { tenantId: session.tenantId, vehicleId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
  return mappings.map(({ providerAssetId, ...mapping }) => ({ ...mapping, providerAssetFingerprint: fingerprint(providerAssetId) }));
}
