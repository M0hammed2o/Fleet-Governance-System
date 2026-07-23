import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  recordInspectionResult,
  GateEventPreconditionError,
  InspectionItemNotFoundError,
  EvidenceMediaAssetNotFoundError,
} from "@/lib/repositories/gate-event-repository";
import { recordInspectionResultSchema } from "@/lib/validation/gate-event";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("gateEvent", "EDIT");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = recordInspectionResultSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const outcome = await recordInspectionResult({
      tenantId: session.tenantId,
      gateEventId: id,
      actorUserId: session.userId,
      ...parsed.data,
    });
    if (!outcome) throw new ApiError(404, "Gate event not found");
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof GateEventPreconditionError) return apiErrorResponse(new ApiError(409, err.message));
    if (err instanceof InspectionItemNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof EvidenceMediaAssetNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
