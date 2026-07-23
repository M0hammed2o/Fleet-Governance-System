import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { createComplianceDocument, InvalidDocumentOwnerError } from "@/lib/repositories/compliance-document-repository";
import { getDriverInTenant } from "@/lib/repositories/driver-repository";
import { getVehicleInTenant } from "@/lib/repositories/vehicle-repository";
import { createComplianceDocumentSchema } from "@/lib/validation/compliance-document";
import { recordAudit } from "@/lib/audit/record-audit";

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("complianceDocument", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createComplianceDocumentSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    // Confirm the owner actually belongs to this tenant before attaching a
    // document to it — same "verify before FK" pattern as gate creation.
    if (parsed.data.ownerType === "DRIVER") {
      const driver = await getDriverInTenant(session.tenantId, parsed.data.driverId!);
      if (!driver) throw new ApiError(400, "That driver does not belong to your company.");
    } else {
      const vehicle = await getVehicleInTenant(session.tenantId, parsed.data.vehicleId!);
      if (!vehicle) throw new ApiError(400, "That vehicle does not belong to your company.");
    }

    const document = await createComplianceDocument({
      tenantId: session.tenantId,
      ownerType: parsed.data.ownerType,
      driverId: parsed.data.driverId,
      vehicleId: parsed.data.vehicleId,
      documentType: parsed.data.documentType,
      documentNumber: parsed.data.documentNumber,
      issueDate: parsed.data.issueDate,
      expiryDate: parsed.data.expiryDate,
      issuer: parsed.data.issuer,
      notes: parsed.data.notes,
    });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "complianceDocument.created",
      entityType: "ComplianceDocument",
      entityId: document.id,
      afterValue: { documentType: document.documentType, ownerType: document.ownerType },
    });

    return NextResponse.json({ document });
  } catch (err) {
    if (err instanceof InvalidDocumentOwnerError) {
      return apiErrorResponse(new ApiError(400, err.message));
    }
    return apiErrorResponse(err);
  }
}
