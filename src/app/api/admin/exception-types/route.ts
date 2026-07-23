import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listExceptionTypesInTenant, upsertExceptionType } from "@/lib/repositories/exception-type-repository";
import { upsertExceptionTypeSchema } from "@/lib/validation/gate-event";

export async function GET() {
  try {
    const session = await requireApiPermission("exception", "VIEW");
    const exceptionTypes = await listExceptionTypesInTenant(session.tenantId);
    return NextResponse.json({ exceptionTypes });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission("exception", "CONFIGURE");
    const body = await request.json().catch(() => null);
    const parsed = upsertExceptionTypeSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const exceptionType = await upsertExceptionType({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      ...parsed.data,
    });
    return NextResponse.json({ exceptionType });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
