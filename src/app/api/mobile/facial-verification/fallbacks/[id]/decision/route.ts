import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import { hasPermission } from "@/lib/auth/authorize";
import {
  mobileApiErrorResponse,
  requireMobileSession,
} from "@/lib/mobile/mobile-api-guard";
import { executeMobileMutation } from "@/lib/mobile/idempotency";
import {
  resolveManualFallback,
  SelfApprovalNotAllowedError,
} from "@/lib/repositories/facial-verification-repository";
import { mobileManualFallbackDecisionSchema } from "@/lib/validation/mobile";
import { listMobileManualFallbacks } from "@/lib/mobile/facial-verification";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    const { id } = await params;
    const parsed = mobileManualFallbackDecisionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(400, "Invalid fallback decision.");
    const permission = parsed.data.decision === "APPROVED" ? "APPROVE" : "REJECT";
    if (!(await hasPermission(session, "facialVerificationFallback", permission)))
      throw new ApiError(403, "This action is not permitted.");
    const result = await executeMobileMutation({
      session,
      key: request.headers.get("idempotency-key"),
      operation: `facialVerificationFallback.${parsed.data.decision}`,
      body: { id, ...parsed.data },
      run: async () => {
        const fallback = await resolveManualFallback({
          tenantId: session.tenantId,
          fallbackId: id,
          approvedByUserId: session.userId,
          decision: parsed.data.decision,
        });
        if (!fallback) throw new ApiError(404, "Fallback request not found.");
        const safe = (
          await listMobileManualFallbacks(
            session.tenantId,
            parsed.data.decision,
            session.userId,
          )
        ).find((item) => item.id === fallback.id);
        if (!safe) throw new ApiError(404, "Fallback request not found.");
        return { fallback: safe };
      },
    });
    return NextResponse.json(result.value, {
      headers: { "Idempotency-Replayed": String(result.replayed) },
    });
  } catch (error) {
    if (error instanceof SelfApprovalNotAllowedError)
      return mobileApiErrorResponse(new ApiError(403, error.message));
    return mobileApiErrorResponse(error);
  }
}
