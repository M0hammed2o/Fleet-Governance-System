import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import {
  referExceptionToInvestigation,
  referFacialVerificationFailureToInvestigation,
  referInspectionFailureToInvestigation,
  referReconciliationDiscrepancyToInvestigation,
} from "@/lib/repositories/investigation-referral-repository";
import { createReferralSchema } from "@/lib/validation/investigations";

/** P11B — creates (or reuses an existing open referral for) a case from an operational source record. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const body = await request.json().catch(() => null);
    const parsed = createReferralSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const { sourceType, sourceRecordId, ...fields } = parsed.data;
    const referFn =
      sourceType === "EXCEPTION"
        ? referExceptionToInvestigation
        : sourceType === "FACIAL_VERIFICATION_ATTEMPT"
          ? referFacialVerificationFailureToInvestigation
          : sourceType === "GATE_EVENT_INSPECTION_ITEM"
            ? referInspectionFailureToInvestigation
            : referReconciliationDiscrepancyToInvestigation;

    const result = await referFn(session, sourceRecordId, fields);
    return NextResponse.json(result, { status: result.wasExistingCase ? 200 : 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
