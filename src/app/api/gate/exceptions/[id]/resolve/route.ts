import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  resolveException,
  SelfApprovalNotAllowedError,
  ExceptionAlreadyResolvedError,
  ExceptionNotEscalatedError,
  GateEventPreconditionError,
} from "@/lib/repositories/gate-event-repository";
import { resolveExceptionSchema } from "@/lib/validation/gate-event";

/**
 * Requires exception:APPROVE — held by supervisory roles (e.g. Security
 * Manager), not by the Gate Security Officer role that raises exceptions
 * (exception:CREATE only). The hard self-approval rule is enforced one level
 * down in gate-event-repository.ts regardless of who holds this permission,
 * so it protects even a future role that's granted both — see DECISIONS.md.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("exception", "APPROVE");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = resolveExceptionSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const outcome = await resolveException({
      tenantId: session.tenantId,
      exceptionId: id,
      actorUserId: session.userId,
      ...parsed.data,
    });
    if (!outcome) throw new ApiError(404, "Exception not found");
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof SelfApprovalNotAllowedError) return apiErrorResponse(new ApiError(403, err.message));
    if (
      err instanceof ExceptionAlreadyResolvedError ||
      err instanceof ExceptionNotEscalatedError ||
      err instanceof GateEventPreconditionError
    ) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    return apiErrorResponse(err);
  }
}
