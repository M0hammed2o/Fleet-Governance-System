import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getMovementInTenant } from "@/lib/repositories/movement-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("movement", "VIEW");
    const { id } = await params;
    const movement = await getMovementInTenant(session.tenantId, id);
    if (!movement) throw new ApiError(404, "Movement not found");
    return NextResponse.json({ movement });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
