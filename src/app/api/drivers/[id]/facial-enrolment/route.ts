import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDriverInTenant } from "@/lib/repositories/driver-repository";
import {
  enrolDriver,
  revokeDriverFacialTemplate,
  getFacialEnrolmentStatus,
  listFacialTemplateHistoryForDriver,
  DriverNotFoundError,
  ConsentNotAcknowledgedError,
  InsufficientCapturesError,
  InconsistentCapturesError,
  NoActiveTemplateError,
} from "@/lib/repositories/facial-enrolment-repository";
import { EncryptionKeyNotConfiguredError } from "@/lib/facial-verification/template-encryption";
import { enrolDriverSchema, revokeFacialTemplateSchema } from "@/lib/validation/facial-verification";

/** Status + full audit history (Phase 9C) — never the template bytes. Gated by the restricted `facialTemplate:VIEW` permission, not ordinary `driver:VIEW`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("facialTemplate", "VIEW");
    const { id } = await params;
    const driver = await getDriverInTenant(session.tenantId, id);
    if (!driver) throw new ApiError(404, "Driver not found");

    const [status, history] = await Promise.all([
      getFacialEnrolmentStatus(session.tenantId, id),
      listFacialTemplateHistoryForDriver(session.tenantId, id),
    ]);

    return NextResponse.json({ status, history });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** Enrol or re-enrol (Phase 9C). Restricted role only (`facialTemplate:CREATE`). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("facialTemplate", "CREATE");
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = enrolDriverSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const template = await enrolDriver({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      driverId: id,
      captureDescriptors: parsed.data.captureDescriptors,
      consentAcknowledged: parsed.data.consentAcknowledged,
    });

    // Never return template bytes — status fields only.
    return NextResponse.json(
      { template: { id: template.id, status: template.status, templateVersion: template.templateVersion, modelVersion: template.modelVersion, enrolledAt: template.enrolledAt } },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof DriverNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof ConsentNotAcknowledgedError || err instanceof InsufficientCapturesError || err instanceof InconsistentCapturesError) {
      return apiErrorResponse(new ApiError(400, err.message));
    }
    if (err instanceof EncryptionKeyNotConfiguredError) return apiErrorResponse(new ApiError(503, err.message));
    return apiErrorResponse(err);
  }
}

/** Revoke the active template (Phase 9C). Restricted role only (`facialTemplate:DELETE`). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("facialTemplate", "DELETE");
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = revokeFacialTemplateSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const revoked = await revokeDriverFacialTemplate(session.tenantId, session.userId, id, parsed.data.reason);
    return NextResponse.json({ template: { id: revoked.id, status: revoked.status, revokedAt: revoked.revokedAt } });
  } catch (err) {
    if (err instanceof NoActiveTemplateError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
