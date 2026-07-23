import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  try {
    const session = await requireApiPermission("role", "VIEW");
    const roles = await prisma.role.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return NextResponse.json({ roles });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
