import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { grantExternalAuditorAccess, listExternalAuditorAccessGrants } from "@/lib/repositories/external-auditor-access-repository";
import { grantExternalAccessSchema } from "@/lib/validation/investigations";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    const { searchParams } = new URL(request.url);
    const caseId = searchParams.get("caseId") ?? undefined;
    const grants = await listExternalAuditorAccessGrants(session, caseId);
    return NextResponse.json({ grants });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const body = await request.json().catch(() => null);
    const parsed = grantExternalAccessSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const grant = await grantExternalAuditorAccess(session, parsed.data);
    return NextResponse.json({ grant }, { status: 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
