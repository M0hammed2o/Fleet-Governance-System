import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { createInvestigationCase, listInvestigationCasesInTenant } from "@/lib/repositories/investigation-case-repository";
import { createInvestigationCaseSchema } from "@/lib/validation/investigations";
import type { InvestigationStatus } from "@/generated/prisma/client";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const assignedInvestigatorUserId = searchParams.get("assignedInvestigatorUserId");
    const search = searchParams.get("search");

    const cases = await listInvestigationCasesInTenant(session, {
      status: (status ?? undefined) as InvestigationStatus | undefined,
      assignedInvestigatorUserId: assignedInvestigatorUserId ?? undefined,
      search: search ?? undefined,
    });
    return NextResponse.json({ cases });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}

/** Manual case creation (P11B/P11S "test manual case creation ... separately"). */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const body = await request.json().catch(() => null);
    const parsed = createInvestigationCaseSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const investigationCase = await createInvestigationCase(session, parsed.data);
    return NextResponse.json({ investigationCase }, { status: 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
