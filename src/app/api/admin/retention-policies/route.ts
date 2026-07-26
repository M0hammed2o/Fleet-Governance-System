import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listRetentionPoliciesInTenant, upsertRetentionPolicy } from "@/lib/repositories/retention-policy-repository";
import { upsertRetentionPolicySchema } from "@/lib/validation/retention";

export async function GET() {
  try {
    const session = await requireApiPermission("retention", "VIEW");
    const policies = await listRetentionPoliciesInTenant(session.tenantId);
    return NextResponse.json({ policies });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("retention", "CONFIGURE");
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError(400, "Expected a JSON body");
    const parsed = upsertRetentionPolicySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const policy = await upsertRetentionPolicy({ tenantId: session.tenantId, actorUserId: session.userId, ...parsed.data });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
