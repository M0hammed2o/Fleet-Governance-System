import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  runOnDeviceFacialVerificationAttempt,
  listFacialVerificationAttemptsForGateEvent,
  GateEventPreconditionError,
  TooManyVerificationAttemptsError,
} from "@/lib/repositories/gate-event-repository";
import { runVerificationAttemptSchema } from "@/lib/validation/facial-verification";
import {
  assertFacialVerificationRuntimeAllowed,
  FacialVerificationActivationBlockedError,
} from "@/lib/operations/facial-verification-readiness";

/** Full audit trail of every verification attempt for this gate event (Phase 9D). Gated by `facialVerificationAttempt:VIEW`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("facialVerificationAttempt", "VIEW");
    const { id } = await params;
    const attempts = await listFacialVerificationAttemptsForGateEvent(session.tenantId, id);
    return NextResponse.json({ attempts });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * Runs one real one-to-one facial verification attempt (Phase 9D) — the
 * live descriptor is computed client-side and sent here for comparison
 * against exactly the one driver's enrolled template; this route never
 * receives or stores raw image/video bytes. Gated by
 * `facialVerificationAttempt:CREATE` (Gate Security Officer).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertFacialVerificationRuntimeAllowed(process.env);
    if (process.env.PILOT_MODE === "true") {
      throw new ApiError(403, "Internal pilot mode permits the labelled synthetic biometric simulator only.");
    }
    const session = await requireApiPermission("facialVerificationAttempt", "CREATE");
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = runVerificationAttemptSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const result = await runOnDeviceFacialVerificationAttempt({
      tenantId: session.tenantId,
      gateEventId: id,
      securityOfficerUserId: session.userId,
      liveDescriptor: parsed.data.captureFailed ? undefined : parsed.data.liveDescriptor,
      captureQualityScore: parsed.data.captureQuality?.score,
      livenessResult: parsed.data.livenessResult,
      livenessChallenge: parsed.data.livenessChallenge,
      deviceLabel: parsed.data.deviceLabel,
      providerUnavailable: parsed.data.providerUnavailable,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (!result) throw new ApiError(404, "Gate event not found");

    return NextResponse.json({ gateEvent: result.gateEvent, attempt: result.attempt });
  } catch (err) {
    if (err instanceof GateEventPreconditionError) return apiErrorResponse(new ApiError(409, err.message));
    if (err instanceof TooManyVerificationAttemptsError) return apiErrorResponse(new ApiError(429, err.message));
    if (err instanceof FacialVerificationActivationBlockedError) return apiErrorResponse(new ApiError(503, err.message));
    return apiErrorResponse(err);
  }
}
