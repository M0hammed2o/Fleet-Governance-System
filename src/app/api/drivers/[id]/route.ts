import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDriverInTenant, updateDriver } from "@/lib/repositories/driver-repository";
import { listManualFallbacksForDriver } from "@/lib/repositories/facial-verification-repository";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { updateDriverSchema } from "@/lib/validation/driver";
import { recordAudit } from "@/lib/audit/record-audit";
import { evaluateDocumentExpiry } from "@/lib/documents/expiry-rules";
import { listAssignmentsInTenant } from "@/lib/repositories/driver-vehicle-assignment-repository";
import { calculateRatingForDriver } from "@/lib/repositories/driver-rating-repository";
import { hasPermission } from "@/lib/auth/authorize";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("driver", "VIEW");
    const { id } = await params;
    const driver = await getDriverInTenant(session.tenantId, id);
    if (!driver) throw new ApiError(404, "Driver not found");

    const [rawDocuments, fallbacks, assignments, rating, gateActivity, auditHistory, canEditPrivateNotes] = await Promise.all([
      prisma.complianceDocument.findMany({ where: tenantWhere(session.tenantId, { driverId: id, archivedAt: null }) }),
      listManualFallbacksForDriver(session.tenantId, id),
      listAssignmentsInTenant(session.tenantId, { driverId: id }),
      calculateRatingForDriver(session.tenantId, id),
      prisma.gateEvent.findMany({ where: tenantWhere(session.tenantId, { driverId: id }), orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, direction: true, decision: true, createdAt: true, vehicle: { select: { id: true, registrationNumber: true } }, gate: { select: { name: true } }, exceptions: { select: { id: true, severity: true, description: true, resolvedAt: true } } } }),
      prisma.auditLog.findMany({ where: tenantWhere(session.tenantId, { OR: [{ entityType: "Driver", entityId: id }, { entityType: "DriverVehicleAssignment", afterValue: { path: ["driverId"], equals: id } }] }), orderBy: { timestamp: "desc" }, take: 30, select: { id: true, timestamp: true, action: true, reason: true, user: { select: { name: true } } } }),
      hasPermission(session, "driver", "EDIT"),
    ]);
    const documents = rawDocuments.map((doc) => ({
      ...doc,
      isExpired: doc.expiryDate ? evaluateDocumentExpiry(doc.expiryDate, null).isExpired : false,
    }));

    return NextResponse.json({ driver: { ...driver, notes: canEditPrivateNotes ? driver.notes : null }, documents, manualFallbacks: fallbacks, assignments, rating: rating?.rating ?? null, gateActivity, auditHistory });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("driver", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateDriverSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const before = await getDriverInTenant(session.tenantId, id);
    if (!before) throw new ApiError(404, "Driver not found");

    const { contactEmail, portraitMediaAssetId, ...rest } = parsed.data;

    // Tenant-ownership-of-a-foreign-key check — stays in the route per D-007
    // (needs the caller's session/tenant context), same pattern as the
    // compliance-documents route's driver/vehicle ownership check.
    if (portraitMediaAssetId) {
      const asset = await prisma.mediaAsset.findFirst({
        where: tenantWhere(session.tenantId, { id: portraitMediaAssetId, ownerType: "DRIVER_PORTRAIT" as const, ownerId: id, binaryDeletedAt: null }),
      });
      if (!asset) throw new ApiError(404, "That media asset does not belong to this driver.");
    }

    const updated = await updateDriver(session.tenantId, id, {
      ...rest,
      ...(contactEmail !== undefined ? { contactEmail: contactEmail || null } : {}),
      ...(portraitMediaAssetId !== undefined ? { portraitMediaAssetId: portraitMediaAssetId || null } : {}),
    });
    if (!updated) throw new ApiError(404, "Driver not found");

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "driver.updated",
      entityType: "Driver",
      entityId: id,
      afterValue: parsed.data,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
