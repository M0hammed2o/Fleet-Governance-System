import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { revokeExternalAuditorAccess } from "@/lib/repositories/external-auditor-access-repository";
import { reasonRequiredSchema } from "@/lib/validation/investigations";

/** Revokes immediately — the portal re-checks a live grant on every call, so revocation takes effect on the auditor's very next request. */
export async function POST(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  try {
    const session = await requireApiSession();
    const { grantId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = reasonRequiredSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const grant = await revokeExternalAuditorAccess(session, grantId, parsed.data.reason);
    return NextResponse.json({ grant });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
