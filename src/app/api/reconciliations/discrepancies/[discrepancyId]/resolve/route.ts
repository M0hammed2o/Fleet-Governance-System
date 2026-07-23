import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { resolveDiscrepancy, DiscrepancyAlreadyResolvedError } from "@/lib/repositories/reconciliation-repository";
import { resolveDiscrepancySchema } from "@/lib/validation/reconciliation";

export async function POST(request: Request, { params }: { params: Promise<{ discrepancyId: string }> }) {
  try {
    const session = await requireApiPermission("reconciliation", "APPROVE");
    const { discrepancyId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = resolveDiscrepancySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const outcome = await resolveDiscrepancy({
      tenantId: session.tenantId,
      discrepancyId,
      actorUserId: session.userId,
      resolutionNotes: parsed.data.resolutionNotes,
      correctiveAction: parsed.data.correctiveAction,
    });
    if (!outcome) throw new ApiError(404, "Discrepancy not found");
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof DiscrepancyAlreadyResolvedError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
