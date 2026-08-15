import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  requireMobilePermission,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { executeMobileMutation } from "@/lib/mobile/idempotency";
import { mobileGateActionSchema } from "@/lib/validation/mobile";
import {
  beginVehicleChecks,
  clearGateEvent,
  completeGateEvent,
  denyGateEvent,
  escalateExceptionToSupervisor,
  moveToIdentityPending,
  raiseException,
  recordInspectionResult,
  runSyntheticFacialVerificationAttempt,
  markIdentityVerifiedManually,
  getGateEventInTenant,
} from "@/lib/repositories/gate-event-repository";
import { requestManualFallback } from "@/lib/repositories/facial-verification-repository";
import { hasPermission } from "@/lib/auth/authorize";
import { assertBiometricSimulatorAllowed } from "@/lib/facial-verification/simulator";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireMobilePermission(request, "gateEvent", "EDIT");
    const { id } = await params;
    const parsed = mobileGateActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid action.",
      );
    if (
      parsed.data.action === "RAISE_EXCEPTION" &&
      !(await hasPermission(session, "exception", "CREATE"))
    )
      throw new ApiError(403, "This action is not permitted.");
    if (
      parsed.data.action === "SYNTHETIC_IDENTITY_VERIFY" &&
      (!(await hasPermission(session, "facialVerificationAttempt", "CREATE")) ||
        process.env.APP_ENV === "production" ||
        process.env.PILOT_MODE !== "true")
    )
      throw new ApiError(
        403,
        "Synthetic identity verification is unavailable.",
      );
    if (
      parsed.data.action === "REQUEST_MANUAL_FALLBACK" &&
      !(await hasPermission(session, "facialVerificationFallback", "CREATE"))
    )
      throw new ApiError(403, "This action is not permitted.");
    if (
      parsed.data.action === "APPLY_APPROVED_FALLBACK" &&
      !(await hasPermission(session, "facialVerificationFallback", "VIEW"))
    )
      throw new ApiError(403, "This action is not permitted.");
    if (parsed.data.action === "SYNTHETIC_IDENTITY_VERIFY") {
      try {
        assertBiometricSimulatorAllowed({
          APP_ENV: process.env.APP_ENV,
          BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY:
            process.env.BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY,
          BIOMETRIC_SIMULATOR_ISOLATED:
            process.env.BIOMETRIC_SIMULATOR_ISOLATED,
        });
      } catch {
        throw new ApiError(403, "Synthetic identity verification is unavailable.");
      }
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    const result = await executeMobileMutation({
      session,
      key: idempotencyKey,
      operation: `gateEvent.${parsed.data.action}`,
      body: { id, ...parsed.data },
      run: async () => {
        switch (parsed.data.action) {
          case "IDENTITY_PENDING":
            return {
              gateEvent: await moveToIdentityPending(
                session.tenantId,
                id,
                session.userId,
              ),
            };
          case "SYNTHETIC_IDENTITY_VERIFY":
            return runSyntheticFacialVerificationAttempt({
              tenantId: session.tenantId,
              gateEventId: id,
              securityOfficerUserId: session.userId,
              scenario: parsed.data.scenario,
              idempotencyKey: idempotencyKey!,
            });
          case "REQUEST_MANUAL_FALLBACK": {
            const event = await getGateEventInTenant(session.tenantId, id);
            if (!event) throw new ApiError(404, "Gate event not found.");
            if (event.status !== "IDENTITY_PENDING")
              throw new ApiError(
                409,
                "Manual fallback can only be requested while identity is pending.",
              );
            return {
              fallback: await requestManualFallback({
                tenantId: session.tenantId,
                driverId: event.driverId,
                requestedByUserId: session.userId,
                reason: parsed.data.reason,
                relatedGateEventId: id,
              }),
            };
          }
          case "APPLY_APPROVED_FALLBACK":
            return {
              gateEvent: await markIdentityVerifiedManually(
                session.tenantId,
                id,
                session.userId,
                parsed.data.manualFallbackId,
              ),
            };
          case "BEGIN_CHECKS":
            return {
              gateEvent: await beginVehicleChecks(
                session.tenantId,
                id,
                session.userId,
              ),
            };
          case "RECORD_INSPECTION":
            return recordInspectionResult({
              tenantId: session.tenantId,
              gateEventId: id,
              actorUserId: session.userId,
              ...parsed.data.input,
            });
          case "RAISE_EXCEPTION":
            return {
              exception: await raiseException({
                tenantId: session.tenantId,
                gateEventId: id,
                actorUserId: session.userId,
                ...parsed.data.input,
              }),
            };
          case "ESCALATE":
            return {
              gateEvent: await escalateExceptionToSupervisor(
                session.tenantId,
                id,
                session.userId,
              ),
            };
          case "CLEAR":
            return {
              gateEvent: await clearGateEvent({
                tenantId: session.tenantId,
                gateEventId: id,
                actorUserId: session.userId,
                reason: parsed.data.reason,
              }),
            };
          case "DENY":
            return {
              gateEvent: await denyGateEvent({
                tenantId: session.tenantId,
                gateEventId: id,
                actorUserId: session.userId,
                reason: parsed.data.reason,
              }),
            };
          case "COMPLETE":
            return {
              gateEvent: await completeGateEvent(
                session.tenantId,
                id,
                session.userId,
              ),
            };
        }
      },
    });
    if (
      !result.value ||
      Object.values(result.value).every((value) => value == null)
    )
      throw new ApiError(404, "Gate event not found.");
    return NextResponse.json(result.value, {
      headers: { "Idempotency-Replayed": String(result.replayed) },
    });
  } catch (error) {
    if (error instanceof ApiError) return mobileApiErrorResponse(error);
    const name = error instanceof Error ? error.name : "";
    if (name === "TooManyVerificationAttemptsError")
      return mobileApiErrorResponse(
        new ApiError(429, (error as Error).message),
      );
    if (
      /Invalid|Precondition|NotApproved|NotAvailable|Already|Fallback/.test(
        name,
      )
    )
      return mobileApiErrorResponse(
        new ApiError(
          409,
          error instanceof Error
            ? error.message
            : "The action is not valid in the current state.",
        ),
      );
    if (/NotFound/.test(name))
      return mobileApiErrorResponse(
        new ApiError(
          404,
          error instanceof Error ? error.message : "Record not found.",
        ),
      );
    return mobileApiErrorResponse(error);
  }
}
