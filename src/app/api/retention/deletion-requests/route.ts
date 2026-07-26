import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { createDeletionRequest, listDeletionRequestsInTenant, EmptyDeletionScopeError } from "@/lib/repositories/retention-repository";
import { createDeletionRequestSchema } from "@/lib/validation/retention";

export async function GET() {
  try {
    const session = await requireApiPermission("retention", "VIEW");
    const deletionRequests = await listDeletionRequestsInTenant(session.tenantId);
    return NextResponse.json({ deletionRequests });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** Company Administrator initiates a deletion request — see ARCHITECTURE.md "Deletion rules". */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("retention", "CREATE");
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = createDeletionRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const result = await createDeletionRequest({ tenantId: session.tenantId, actorUserId: session.userId, ...parsed.data });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof EmptyDeletionScopeError) return apiErrorResponse(new ApiError(409, err.message));
    return apiErrorResponse(err);
  }
}
