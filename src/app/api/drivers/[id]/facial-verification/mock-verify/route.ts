import { NextResponse } from "next/server";
import { requireApiPermission, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { getDriverInTenant } from "@/lib/repositories/driver-repository";
import { MockFacialVerificationProvider } from "@/lib/facial-verification/mock-provider";
import { recordAudit } from "@/lib/audit/record-audit";
import { z } from "zod";

const bodySchema = z.object({ capturedImageRef: z.string().trim().min(1) });
const provider = new MockFacialVerificationProvider();

/**
 * Dev-mode endpoint exercising the FacialVerificationProvider interface —
 * see lib/facial-verification/provider.ts. Not tied to a gate event (Phase 3
 * doesn't exist yet); this just proves the interface/mock/audit-logging work.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiPermission("driver", "VIEW");
    const { id } = await params;
    const driver = await getDriverInTenant(session.tenantId, id);
    if (!driver) throw new ApiError(404, "Driver not found");

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const outcome = await provider.verifyDriver(id, parsed.data.capturedImageRef);

    await recordAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "facialVerification.attempted",
      entityType: "Driver",
      entityId: id,
      afterValue: { result: outcome.result, providerReference: outcome.providerReference },
    });

    return NextResponse.json({ outcome });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
