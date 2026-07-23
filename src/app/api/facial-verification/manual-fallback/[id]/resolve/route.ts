import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { hasPermission } from "@/lib/auth/authorize";
import { resolveManualFallback, SelfApprovalNotAllowedError } from "@/lib/repositories/facial-verification-repository";
import { resolveManualFallbackSchema } from "@/lib/validation/driver";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = resolveManualFallbackSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    // APPROVED and DENIED are separately-grantable actions (APPROVE/REJECT),
    // same split as movement approval — checked against the actual decision,
    // not a single blanket "resolve" permission.
    const requiredAction = parsed.data.decision === "APPROVED" ? "APPROVE" : "REJECT";
    const allowed = await hasPermission(session, "facialVerificationFallback", requiredAction);
    if (!allowed) throw new ApiError(403, "Forbidden");

    const fallback = await resolveManualFallback({
      tenantId: session.tenantId,
      fallbackId: id,
      approvedByUserId: session.userId,
      decision: parsed.data.decision,
    });
    if (!fallback) throw new ApiError(404, "Fallback request not found");

    return NextResponse.json({ fallback });
  } catch (err) {
    if (err instanceof SelfApprovalNotAllowedError) {
      return apiErrorResponse(new ApiError(403, err.message));
    }
    return apiErrorResponse(err);
  }
}
