import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getVehicleInTenant, updateVehicle, DuplicateVehicleIdentifierError } from "@/lib/repositories/vehicle-repository";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { updateVehicleSchema } from "@/lib/validation/vehicle";
import { recordAudit } from "@/lib/audit/record-audit";
import { evaluateDocumentExpiry } from "@/lib/documents/expiry-rules";
import { hasPermission } from "@/lib/auth/authorize";
import { trackerProvenanceDisplay } from "@/lib/telematics/provenance";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("vehicle", "VIEW");
    const { id } = await params;
    const vehicle = await getVehicleInTenant(session.tenantId, id);
    if (!vehicle) throw new ApiError(404, "Vehicle not found");

    const rawDocuments = await prisma.complianceDocument.findMany({
      where: tenantWhere(session.tenantId, { vehicleId: id, archivedAt: null }),
    });
    const documents = rawDocuments.map((doc) => ({
      ...doc,
      isExpired: doc.expiryDate ? evaluateDocumentExpiry(doc.expiryDate, null).isExpired : false,
    }));

    // Recent telematics activity (GPS-001..006) — omitted for a role with no
    // telematics:VIEW at all, same gating pattern used for movement documents.
    let recentTelematicsEvents: unknown[] = [];
    let manualGpsConfirmations: unknown[] = [];
    let trackerDataSummary = trackerProvenanceDisplay({ source: null, freshness: null, isSynthetic: false });
    let trackerMappingStatus = "UNMAPPED";
    if (await hasPermission(session, "telematics", "VIEW")) {
      const [events, confirmations, activeMapping] = await Promise.all([
        prisma.telematicsEvent.findMany({ where: tenantWhere(session.tenantId, { vehicleId: id }), orderBy: { recordedAt: "desc" }, take: 20, select: { id: true, source: true, latitude: true, longitude: true, speedKmh: true, headingDegrees: true, ignitionOn: true, odometerKm: true, recordedAt: true, receivedAt: true, normalizedAt: true, freshness: true, accuracyMeters: true, mappingState: true, processingStatus: true, correctionStatus: true, confidenceLimitations: true, isSynthetic: true } }),
        prisma.manualGpsConfirmation.findMany({ where: tenantWhere(session.tenantId, { vehicleId: id }), orderBy: { requestedAt: "desc" }, take: 20 }),
        prisma.trackerVehicleMapping.findFirst({ where: tenantWhere(session.tenantId, { vehicleId: id, effectiveFrom: { lte: new Date() }, effectiveTo: null }), select: { source: true } }),
      ]);
      recentTelematicsEvents = events;
      manualGpsConfirmations = confirmations;
      const latest = events[0];
      trackerDataSummary = trackerProvenanceDisplay({ source: latest?.source ?? null, freshness: latest?.freshness ?? null, isSynthetic: Boolean(latest?.isSynthetic || activeMapping?.source === "SYNTHETIC") });
      trackerMappingStatus = activeMapping ? activeMapping.source === "SYNTHETIC" ? "SYNTHETIC MAPPING — NOT LIVE" : "MAPPED — PROVIDER NOT YET VERIFIED" : "UNMAPPED";
    }

    return NextResponse.json({ vehicle, documents, recentTelematicsEvents, manualGpsConfirmations, trackerDataSummary, trackerMappingStatus });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("vehicle", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateVehicleSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const before = await getVehicleInTenant(session.tenantId, id);
    if (!before) throw new ApiError(404, "Vehicle not found");

    const { vin, assignedDriverId, tyrePositionConfigId, ...rest } = parsed.data;
    const updated = await updateVehicle(session.tenantId, id, {
      ...rest,
      ...(vin !== undefined ? { vin: vin || null } : {}),
      ...(assignedDriverId !== undefined ? { assignedDriverId: assignedDriverId || null } : {}),
      ...(tyrePositionConfigId !== undefined ? { tyrePositionConfigId: tyrePositionConfigId || null } : {}),
    });
    if (!updated) throw new ApiError(404, "Vehicle not found");

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "vehicle.updated",
      entityType: "Vehicle",
      entityId: id,
      afterValue: parsed.data,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DuplicateVehicleIdentifierError) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    return apiErrorResponse(err);
  }
}
