import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDriverInTenant, updateDriver } from "@/lib/repositories/driver-repository";
import { listManualFallbacksForDriver } from "@/lib/repositories/facial-verification-repository";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { updateDriverSchema } from "@/lib/validation/driver";
import { recordAudit } from "@/lib/audit/record-audit";
import { evaluateDocumentExpiry } from "@/lib/documents/expiry-rules";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("driver", "VIEW");
    const { id } = await params;
    const driver = await getDriverInTenant(session.tenantId, id);
    if (!driver) throw new ApiError(404, "Driver not found");

    const [rawDocuments, fallbacks] = await Promise.all([
      prisma.complianceDocument.findMany({ where: tenantWhere(session.tenantId, { driverId: id, archivedAt: null }) }),
      listManualFallbacksForDriver(session.tenantId, id),
    ]);
    const documents = rawDocuments.map((doc) => ({
      ...doc,
      isExpired: doc.expiryDate ? evaluateDocumentExpiry(doc.expiryDate, null).isExpired : false,
    }));

    return NextResponse.json({ driver, documents, manualFallbacks: fallbacks });
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
        where: tenantWhere(session.tenantId, { id: portraitMediaAssetId, ownerType: "DRIVER_PORTRAIT" as const, ownerId: id }),
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
