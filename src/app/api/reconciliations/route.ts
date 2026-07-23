import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  listReconciliationsInTenant,
  buildReconciliation,
  MovementNotFoundError,
  GateEventNotFoundError,
  ReconciliationNotReadyError,
  GateEventNotCompletedError,
  SameGateEventPairingError,
  SameDirectionPairingError,
  ReversedPairingError,
  MismatchedMovementPairingError,
  MismatchedVehiclePairingError,
  DuplicateReconciliationPairingError,
} from "@/lib/repositories/reconciliation-repository";
import { buildReconciliationSchema, reconciliationStatusSchema } from "@/lib/validation/reconciliation";

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("reconciliation", "VIEW");
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status = statusParam ? reconciliationStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) throw new ApiError(400, "Invalid status filter");
    const page = Number(url.searchParams.get("page") ?? "1") || 1;

    const result = await listReconciliationsInTenant(session.tenantId, { status: status?.data, page });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * Manually (re)trigger pairing/build for a movement or an explicit gate-event
 * pair — idempotent, safe to retry (RECON-001). The common path is automatic
 * (completeGateEvent), this exists for the cases it can't cover: an officer
 * retrying after a transient failure, or a supervisor manually pairing an
 * unusual multi-leg movement.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("reconciliation", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = buildReconciliationSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const reconciliation = await buildReconciliation({
      tenantId: session.tenantId,
      movementAuthorisationId: parsed.data.movementAuthorisationId,
      departureGateEventId: parsed.data.departureGateEventId,
      returnGateEventId: parsed.data.returnGateEventId,
      actorUserId: session.userId,
    });
    return NextResponse.json({ reconciliation });
  } catch (err) {
    if (err instanceof MovementNotFoundError || err instanceof GateEventNotFoundError) {
      return apiErrorResponse(new ApiError(404, err.message));
    }
    if (
      err instanceof ReconciliationNotReadyError ||
      err instanceof GateEventNotCompletedError ||
      err instanceof SameGateEventPairingError ||
      err instanceof SameDirectionPairingError ||
      err instanceof ReversedPairingError ||
      err instanceof MismatchedMovementPairingError ||
      err instanceof MismatchedVehiclePairingError ||
      err instanceof DuplicateReconciliationPairingError
    ) {
      return apiErrorResponse(new ApiError(409, err.message));
    }
    return apiErrorResponse(err);
  }
}
