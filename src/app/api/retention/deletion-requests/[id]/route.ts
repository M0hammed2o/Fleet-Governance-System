import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDeletionRequestInTenant } from "@/lib/repositories/retention-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("retention", "VIEW");
    const { id } = await params;
    const deletionRequest = await getDeletionRequestInTenant(session.tenantId, id);
    if (!deletionRequest) throw new ApiError(404, "Deletion request not found");
    return NextResponse.json({ deletionRequest });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
