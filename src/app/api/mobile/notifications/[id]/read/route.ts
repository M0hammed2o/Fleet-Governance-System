import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/api-guard";
import {
  requireMobileSession,
  mobileApiErrorResponse,
} from "@/lib/mobile/mobile-api-guard";
import { executeMobileMutation } from "@/lib/mobile/idempotency";
import { markMobileNotificationRead } from "@/lib/mobile/notifications";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    const { id } = await params;
    if (!/^[A-Za-z0-9:-]{3,240}$/.test(id))
      throw new ApiError(400, "Invalid notification identifier.");
    const result = await executeMobileMutation({
      session,
      key: request.headers.get("idempotency-key"),
      operation: "notification.read",
      body: { id },
      run: async () => {
        if (!(await markMobileNotificationRead(session, id)))
          throw new ApiError(404, "Notification not found.");
        return { ok: true as const };
      },
    });
    return NextResponse.json(result.value, {
      headers: { "Idempotency-Replayed": String(result.replayed) },
    });
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
