import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { generateInvestigationReport, listInvestigationReports } from "@/lib/repositories/investigation-report-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const reports = await listInvestigationReports(session, id);
    return NextResponse.json({ reports });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}

/** Generates a new immutable report PDF version from an APPROVED finding (P11J) — body: { findingId }. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const findingId = body && typeof body === "object" && "findingId" in body ? String((body as { findingId: unknown }).findingId) : null;
    if (!findingId) throw new ApiError(400, "findingId is required");

    const report = await generateInvestigationReport(session, id, findingId);
    return NextResponse.json({ report }, { status: 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
