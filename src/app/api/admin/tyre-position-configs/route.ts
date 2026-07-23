import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listTyrePositionConfigsInTenant, createTyrePositionConfig } from "@/lib/repositories/tyre-config-repository";
import { createTyrePositionConfigSchema } from "@/lib/validation/tyre-config";
import { recordAudit } from "@/lib/audit/record-audit";

export async function GET() {
  try {
    const session = await requireApiPermission("tyrePositionConfig", "VIEW");
    const configs = await listTyrePositionConfigsInTenant(session.tenantId);
    return NextResponse.json({ configs });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("tyrePositionConfig", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createTyrePositionConfigSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const config = await createTyrePositionConfig({ tenantId: session.tenantId, ...parsed.data });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "tyrePositionConfig.created",
      entityType: "TyrePositionConfig",
      entityId: config.id,
      afterValue: { name: config.name, category: config.category },
    });

    return NextResponse.json({ config });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
