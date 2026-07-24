import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  endSupportAccessSession,
  NotSessionActorError,
  SupportAccessSessionAlreadyEndedError,
} from "@/lib/repositories/support-access-repository";

/** SUPPORT-003 — immediate exit action. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;

    const accessSession = await endSupportAccessSession(session, id);
    if (!accessSession) throw new ApiError(404, "Support access session not found");
    return NextResponse.json({ accessSession });
  } catch (err) {
    if (err instanceof NotSessionActorError) return apiErrorResponse(new ApiError(403, err.message));
    if (err instanceof SupportAccessSessionAlreadyEndedError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
