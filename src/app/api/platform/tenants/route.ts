import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { listAllTenantsAsPlatformAdmin, createTenantAsPlatformAdmin } from "@/lib/repositories/platform-tenant-repository";
import { createTenantSchema } from "@/lib/validation/auth";
import { prisma } from "@/lib/db/prisma";

// Permission checks happen inside the repository functions themselves (see
// platform-tenant-repository.ts) — this route only needs a valid session.

export async function GET() {
  try {
    const session = await requireApiSession();
    const tenants = await listAllTenantsAsPlatformAdmin(session);
    return NextResponse.json({ tenants });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const body = await request.json().catch(() => null);
    const parsed = createTenantSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const existing = await prisma.tenant.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) throw new ApiError(409, "A tenant with that slug already exists.");

    const tenant = await createTenantAsPlatformAdmin(session, parsed.data);
    return NextResponse.json({ tenant });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
