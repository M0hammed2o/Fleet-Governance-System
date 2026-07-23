import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listDriversInTenant, createDriver } from "@/lib/repositories/driver-repository";
import { createDriverSchema } from "@/lib/validation/driver";
import { recordAudit } from "@/lib/audit/record-audit";

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("driver", "VIEW");
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? undefined;
    const status = url.searchParams.get("status") as "ACTIVE" | "SUSPENDED" | "BLACKLISTED" | null;
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const pageSizeParam = url.searchParams.get("pageSize");
    const pageSize = pageSizeParam ? Number(pageSizeParam) || undefined : undefined;

    const result = await listDriversInTenant(session.tenantId, { search, status: status ?? undefined, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("driver", "CREATE");
    const body = await request.json().catch(() => null);
    const parsed = createDriverSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const { contactEmail, ...rest } = parsed.data;
    const driver = await createDriver(session.tenantId, {
      ...rest,
      contactEmail: contactEmail || undefined,
    });

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "driver.created",
      entityType: "Driver",
      entityId: driver.id,
      afterValue: { name: driver.name, employeeNumber: driver.employeeNumber },
    });

    return NextResponse.json({ driver });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
