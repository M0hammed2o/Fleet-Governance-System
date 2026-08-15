import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { SYNTHETIC_BIOMETRIC_LABEL } from "@/lib/facial-verification/contracts";
import {
  VERIFICATION_ATTEMPT_RATE_LIMIT,
  VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES,
} from "@/lib/repositories/gate-event-repository";
import type {
  MobileFacialIdentityContext,
  MobileManualFallbackSummary,
} from "@genbridge/shared-types";

function fallbackSummary(
  fallback: Awaited<ReturnType<typeof findFallback>>,
  principalUserId: string,
): MobileManualFallbackSummary | null {
  if (!fallback) return null;
  return {
    id: fallback.id,
    gateEventId: fallback.relatedGateEventId,
    driver: fallback.driver,
    reason: fallback.reason,
    status: fallback.status,
    requestedBy: fallback.requestedBy,
    approvedBy: fallback.approvedBy,
    requestedAt: fallback.requestedAt.toISOString(),
    resolvedAt: fallback.resolvedAt?.toISOString() ?? null,
    selfApprovalBlocked: fallback.requestedByUserId === principalUserId,
  };
}

function findFallback(tenantId: string, where: { relatedGateEventId?: string; status?: "PENDING" | "APPROVED" | "DENIED" }) {
  return prisma.manualFacialVerificationFallback.findFirst({
    where: tenantWhere(tenantId, where),
    orderBy: { requestedAt: "desc" },
    include: {
      driver: { select: { id: true, name: true, employeeNumber: true } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  });
}

export async function getMobileFacialVerificationContext(
  tenantId: string,
  gateEventId: string,
  principalUserId: string,
): Promise<MobileFacialIdentityContext> {
  const [template, latestAttempt, fallback, recentAttemptCount] =
    await Promise.all([
      prisma.driverFacialTemplate.findFirst({
        where: tenantWhere(tenantId, {
          driver: { gateEvents: { some: { id: gateEventId, tenantId } } },
          status: "ACTIVE" as const,
        }),
        orderBy: { version: "desc" },
        select: { version: true, synthetic: true },
      }),
      prisma.facialVerificationAttempt.findFirst({
        where: tenantWhere(tenantId, { gateEventId }),
        orderBy: { attemptedAt: "desc" },
        select: {
          id: true,
          result: true,
          livenessResult: true,
          safeErrorCode: true,
          attemptedAt: true,
          synthetic: true,
          syntheticDisclosure: true,
          providerId: true,
          policyVersion: true,
        },
      }),
      findFallback(tenantId, { relatedGateEventId: gateEventId }),
      prisma.facialVerificationAttempt.count({
        where: tenantWhere(tenantId, {
          gateEventId,
          attemptedAt: {
            gte: new Date(
              Date.now() -
                VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES * 60 * 1000,
            ),
          },
        }),
      }),
    ]);
  const hasAuditableIdentityActivity = Boolean(fallback || latestAttempt);
  const audit = hasAuditableIdentityActivity
    ? await prisma.auditLog.findFirst({
        where: tenantWhere(tenantId, {
          relatedGateEventId: gateEventId,
          OR: [
            { action: { startsWith: "facialVerification." } },
            { action: { startsWith: "gateEvent.identityVerified" } },
          ],
        }),
        orderBy: { timestamp: "desc" },
        select: { action: true, timestamp: true },
      })
    : null;
  return {
    disclosure: SYNTHETIC_BIOMETRIC_LABEL,
    enrolment: {
      status: template ? "ENROLLED" : "NOT_ENROLLED",
      version: template?.version ?? null,
      synthetic: template?.synthetic ?? null,
    },
    latestAttempt: latestAttempt
      ? {
          id: latestAttempt.id,
          result: latestAttempt.result,
          livenessResult: latestAttempt.livenessResult,
          safeErrorCode: latestAttempt.safeErrorCode,
          attemptedAt: latestAttempt.attemptedAt.toISOString(),
          synthetic: true,
          disclosure: SYNTHETIC_BIOMETRIC_LABEL,
          providerId: latestAttempt.providerId,
          policyVersion: latestAttempt.policyVersion,
        }
      : null,
    attemptsRemaining: Math.max(
      0,
      VERIFICATION_ATTEMPT_RATE_LIMIT - recentAttemptCount,
    ),
    rateLimit: {
      maximum: VERIFICATION_ATTEMPT_RATE_LIMIT,
      windowMinutes: VERIFICATION_ATTEMPT_RATE_WINDOW_MINUTES,
    },
    fallback: fallbackSummary(fallback, principalUserId),
    auditConfirmation: audit
      ? {
          recorded: true,
          action: audit.action,
          recordedAt: audit.timestamp.toISOString(),
        }
      : null,
  };
}

export async function listMobileManualFallbacks(
  tenantId: string,
  status: "PENDING" | "APPROVED" | "DENIED",
  principalUserId: string,
): Promise<MobileManualFallbackSummary[]> {
  const rows = await prisma.manualFacialVerificationFallback.findMany({
    where: tenantWhere(tenantId, { status }),
    orderBy: { requestedAt: "asc" },
    include: {
      driver: { select: { id: true, name: true, employeeNumber: true } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  });
  return rows.map((row) => fallbackSummary(row, principalUserId)!);
}
