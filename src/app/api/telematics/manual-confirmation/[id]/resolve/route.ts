import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { resolveManualGpsConfirmation, SelfApprovalNotAllowedError } from "@/lib/repositories/telematics-repository";
import { resolveManualGpsConfirmationSchema } from "@/lib/validation/telematics";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("telematics", "APPROVE");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = resolveManualGpsConfirmationSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const confirmation = await resolveManualGpsConfirmation({
      tenantId: session.tenantId,
      confirmationId: id,
      approvedByUserId: session.userId,
      decision: parsed.data.decision,
    });
    if (!confirmation) throw new ApiError(404, "Manual GPS confirmation request not found");
    return NextResponse.json({ confirmation });
  } catch (err) {
    if (err instanceof SelfApprovalNotAllowedError) return apiErrorResponse(new ApiError(403, err.message));
    return apiErrorResponse(err);
  }
}
