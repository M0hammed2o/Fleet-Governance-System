import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  simulateMockPaymentCompletion,
  InvoiceForPaymentNotFoundError,
  NoPendingPaymentAttemptError,
  MockSimulationNotAvailableError,
} from "@/lib/repositories/payment-repository";
import { z } from "zod";

const simulatePaymentSchema = z.object({ outcome: z.enum(["SUCCESSFUL", "FAILED"]).default("SUCCESSFUL") });

/** Dev/test-only — drives the mock payment provider's webhook path so the customer Accountant portal can demonstrate a real payment succeeding/failing without a production gateway. Never available against a real provider (MockSimulationNotAvailableError). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("payment", "CREATE");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = simulatePaymentSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const result = await simulateMockPaymentCompletion(session, id, parsed.data.outcome);
    return NextResponse.json({ result: result.outcome });
  } catch (err) {
    if (err instanceof InvoiceForPaymentNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    if (err instanceof NoPendingPaymentAttemptError || err instanceof MockSimulationNotAvailableError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
