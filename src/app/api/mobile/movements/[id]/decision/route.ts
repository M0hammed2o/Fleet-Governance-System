import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  requireMobilePermission,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { executeMobileMutation } from "@/lib/mobile/idempotency";
import { mobileMovementApprovalSchema } from "@/lib/validation/mobile";
import {
  approveMovement,
  rejectMovement,
  SelfApprovalNotAllowedError,
} from "@/lib/repositories/movement-repository";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireMobilePermission(
      request,
      "movement",
      "APPROVE",
    );
    const { id } = await params;
    const parsed = mobileMovementApprovalSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid decision.",
      );
    const result = await executeMobileMutation({
      session,
      key: request.headers.get("idempotency-key"),
      operation: `movement.${parsed.data.decision}`,
      body: { id, ...parsed.data },
      run: async () => {
        const input = {
          tenantId: session.tenantId,
          movementId: id,
          approverUserId: session.userId,
          comments: parsed.data.comments,
        };
        const movement =
          parsed.data.decision === "APPROVE"
            ? await approveMovement(input)
            : await rejectMovement(input);
        if (!movement) throw new ApiError(404, "Movement not found.");
        return { movement };
      },
    });
    return NextResponse.json(result.value, {
      headers: { "Idempotency-Replayed": String(result.replayed) },
    });
  } catch (error) {
    if (error instanceof SelfApprovalNotAllowedError)
      return mobileApiErrorResponse(new ApiError(403, error.message));
    if (
      error instanceof Error &&
      error.name === "InvalidMovementTransitionError"
    )
      return mobileApiErrorResponse(new ApiError(409, error.message));
    return mobileApiErrorResponse(error);
  }
}
