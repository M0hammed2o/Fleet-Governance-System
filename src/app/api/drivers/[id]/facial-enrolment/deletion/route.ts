import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import {
  approveBiometricTemplateDeletion,
  BiometricDeletionNotFoundError,
  BiometricDeletionSelfApprovalError,
  BiometricDeletionStateError,
  completeBiometricTemplateDeletion,
  listBiometricDeletionRequests,
  requestBiometricTemplateDeletion,
} from "@/lib/repositories/biometric-deletion-repository";
import {
  biometricDeletionDecisionSchema,
  biometricDeletionRequestSchema,
} from "@/lib/validation/facial-verification";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireApiPermission("facialTemplate", "VIEW");
    const { id } = await params;
    return NextResponse.json({
      requests: await listBiometricDeletionRequests(session.tenantId, id),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireApiPermission("facialTemplate", "DELETE");
    const { id } = await params;
    const parsed = biometricDeletionRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid deletion request");
    }
    const deletionRequest = await requestBiometricTemplateDeletion({
      tenantId: session.tenantId,
      driverId: id,
      actorUserId: session.userId,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ deletionRequest }, { status: 201 });
  } catch (error) {
    if (error instanceof BiometricDeletionNotFoundError) {
      return apiErrorResponse(new ApiError(404, error.message));
    }
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApiPermission("facialTemplate", "DELETE");
    const parsed = biometricDeletionDecisionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid deletion decision");
    }
    const result = parsed.data.action === "APPROVE"
      ? await approveBiometricTemplateDeletion({
          tenantId: session.tenantId,
          requestId: parsed.data.requestId,
          actorUserId: session.userId,
        })
      : await completeBiometricTemplateDeletion({
          tenantId: session.tenantId,
          requestId: parsed.data.requestId,
          actorUserId: session.userId,
        });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof BiometricDeletionNotFoundError) {
      return apiErrorResponse(new ApiError(404, error.message));
    }
    if (error instanceof BiometricDeletionSelfApprovalError) {
      return apiErrorResponse(new ApiError(403, error.message));
    }
    if (error instanceof BiometricDeletionStateError) {
      return apiErrorResponse(new ApiError(409, error.message));
    }
    return apiErrorResponse(error);
  }
}
