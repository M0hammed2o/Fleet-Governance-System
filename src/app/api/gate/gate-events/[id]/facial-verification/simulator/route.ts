import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireApiPermission } from "@/lib/auth/api-guard";
import {
  GateEventPreconditionError,
  runSyntheticFacialVerificationAttempt,
  TooManyVerificationAttemptsError,
} from "@/lib/repositories/gate-event-repository";
import {
  assertBiometricSimulatorAllowed,
  BIOMETRIC_SIMULATOR_SCENARIOS,
  BiometricSimulatorEnvironmentError,
} from "@/lib/facial-verification/simulator";
import { z } from "zod";

const schema = z.object({
  scenario: z.enum(BIOMETRIC_SIMULATOR_SCENARIOS),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (process.env.PILOT_MODE !== "true") {
      throw new ApiError(403, "Synthetic biometric rehearsal is disabled.");
    }
    assertBiometricSimulatorAllowed({
      APP_ENV: process.env.APP_ENV,
      BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY:
        process.env.BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY,
      BIOMETRIC_SIMULATOR_ISOLATED:
        process.env.BIOMETRIC_SIMULATOR_ISOLATED,
    });
    const session = await requireApiPermission("facialVerificationAttempt", "CREATE");
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid synthetic scenario");
    }
    const result = await runSyntheticFacialVerificationAttempt({
      tenantId: session.tenantId,
      gateEventId: id,
      securityOfficerUserId: session.userId,
      ...parsed.data,
    });
    if (!result) throw new ApiError(404, "Gate event not found");
    return NextResponse.json(result, {
      headers: { "Idempotency-Replayed": String(result.duplicate) },
    });
  } catch (error) {
    if (error instanceof BiometricSimulatorEnvironmentError) return apiErrorResponse(new ApiError(403, error.message));
    if (error instanceof GateEventPreconditionError) return apiErrorResponse(new ApiError(409, error.message));
    if (error instanceof TooManyVerificationAttemptsError) return apiErrorResponse(new ApiError(429, error.message));
    return apiErrorResponse(error);
  }
}
