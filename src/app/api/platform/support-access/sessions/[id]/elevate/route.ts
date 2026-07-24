import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import {
  elevateSupportAccessSession,
  NotSessionActorError,
  SupportAccessSessionNotActiveError,
} from "@/lib/repositories/support-access-repository";
import { elevateSupportAccessSessionSchema } from "@/lib/validation/support-access";

/** SUPPORT-003 — explicit elevated-access workflow, a deliberate second action. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = elevateSupportAccessSessionSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const accessSession = await elevateSupportAccessSession({ session, accessSessionId: id, elevatedReason: parsed.data.elevatedReason });
    if (!accessSession) throw new ApiError(404, "Support access session not found");
    return NextResponse.json({ accessSession });
  } catch (err) {
    if (err instanceof NotSessionActorError) return apiErrorResponse(new ApiError(403, err.message));
    if (err instanceof SupportAccessSessionNotActiveError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
