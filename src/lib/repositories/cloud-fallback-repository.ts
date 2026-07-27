import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { NoOpCloudLivenessProvider, type CloudLivenessProvider, type CloudLivenessRequest } from "@/lib/facial-verification/cloud-liveness-provider";

/**
 * Phase 9F — cloud liveness fallback, tracked per tenant for future
 * billing (CloudFallbackInvocation). No paid vendor exists
 * (FACIAL_VERIFICATION_LICENSING.md), so `defaultProvider` is the honest
 * no-op — every real invocation still gets its own bookkeeping row and
 * audit entry regardless of the provider's actual outcome.
 */
const defaultProvider: CloudLivenessProvider = new NoOpCloudLivenessProvider();

export interface InvokeCloudLivenessFallbackInput {
  tenantId: string;
  actorUserId: string;
  driverId: string;
  facialVerificationAttemptId?: string;
  reason: CloudLivenessRequest["reason"];
  frameCount: number;
}

export async function invokeCloudLivenessFallback(input: InvokeCloudLivenessFallbackInput, provider: CloudLivenessProvider = defaultProvider) {
  const outcome = await provider.checkLiveness({
    tenantId: input.tenantId,
    driverId: input.driverId,
    frameCount: input.frameCount,
    reason: input.reason,
  });

  const invocation = await prisma.cloudFallbackInvocation.create({
    data: {
      tenantId: input.tenantId,
      facialVerificationAttemptId: input.facialVerificationAttemptId,
      reason: input.reason,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "facialVerification.cloudFallbackInvoked",
    entityType: "CloudFallbackInvocation",
    entityId: invocation.id,
    afterValue: { reason: input.reason, result: outcome.result, driverId: input.driverId },
  });

  return { invocation, outcome };
}

/** Usage counts by reason — the basis a future real billing integration would report from. */
export async function getCloudFallbackUsageForTenant(tenantId: string) {
  return prisma.cloudFallbackInvocation.groupBy({ by: ["reason"], where: tenantWhere(tenantId), _count: { _all: true } });
}
