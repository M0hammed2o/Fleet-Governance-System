import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { createExportRequest, listExportRequestsInTenant } from "@/lib/repositories/retention-repository";
import { createExportRequestSchema } from "@/lib/validation/retention";

export async function GET() {
  try {
    const session = await requireApiPermission("retention", "EXPORT");
    const exportRequests = await listExportRequestsInTenant(session.tenantId);
    return NextResponse.json({ exportRequests });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** "Export and then delete" — one of the four customer retention choices (ARCHITECTURE.md). */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("retention", "EXPORT");
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = createExportRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const exportRequest = await createExportRequest({ tenantId: session.tenantId, actorUserId: session.userId, ...parsed.data });
    return NextResponse.json({ exportRequest }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
