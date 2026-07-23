import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { raiseException, listExceptionsForGateEvent } from "@/lib/repositories/gate-event-repository";
import { raiseExceptionSchema } from "@/lib/validation/gate-event";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("exception", "VIEW");
    const { id } = await params;
    const exceptions = await listExceptionsForGateEvent(session.tenantId, id);
    return NextResponse.json({ exceptions });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("exception", "CREATE");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = raiseExceptionSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const exception = await raiseException({
      tenantId: session.tenantId,
      gateEventId: id,
      actorUserId: session.userId,
      ...parsed.data,
    });
    if (!exception) throw new ApiError(404, "Gate event not found");
    return NextResponse.json({ exception });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
