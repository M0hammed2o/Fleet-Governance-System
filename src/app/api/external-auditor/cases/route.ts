import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { listPermittedCasesForAuditor } from "@/lib/repositories/external-auditor-access-repository";

/** P11L — the only case-listing surface an External Auditor (Case-Scoped) session can ever reach: exactly the cases their currently-active grants permit. */
export async function GET() {
  try {
    const session = await requireApiSession();
    const cases = await listPermittedCasesForAuditor(session);
    return NextResponse.json({ cases });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
