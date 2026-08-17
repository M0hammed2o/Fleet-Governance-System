import "server-only";
import { prisma } from "@/lib/db/prisma";
import { getDefaultInvestigationNotificationProvider } from "@/lib/investigations/investigation-notification-provider";
import type { InvestigationNotificationEventType } from "@/generated/prisma/client";

const NOTIFICATION_BATCH_SIZE = 200;
const MAX_DELIVERY_ATTEMPTS = 3;

function nextRetryAt(now: Date, completedAttempts: number): Date | null {
  if (completedAttempts >= MAX_DELIVERY_ATTEMPTS) return null;
  if (completedAttempts === 1) return now;
  return new Date(now.getTime() + 5 * 60 * 1000 * 2 ** (completedAttempts - 2));
}

/**
 * P11N — notification records are created and (best-effort) delivered in
 * one step by queueInvestigationNotification(); failures are persisted as
 * status FAILED with a reason and are picked up again by
 * retryFailedInvestigationNotifications() on its next run — the same
 * "next scheduled run, not stuck forever" shape as
 * retention-notification-repository.ts. Never sends a real external
 * message in this build (NoOp is the default provider everywhere) and
 * never touches InvestigationCase.status.
 */

export interface QueueNotificationInput {
  tenantId: string;
  caseId: string;
  eventType: InvestigationNotificationEventType;
  recipientUserId: string;
  message: string;
}

function isConcurrentDeletion(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && ["P2003", "P2025"].includes((error as { code?: string }).code ?? "");
}

async function attemptDelivery(recipientEmail: string, recipientName: string, caseNumber: string, caseTitle: string, eventType: string, message: string) {
  const provider = getDefaultInvestigationNotificationProvider();
  try {
    const result = await provider.send({ toEmail: recipientEmail, recipientName, caseNumber, caseTitle, eventType, message });
    return result;
  } catch (err) {
    return { delivered: false, failureReason: err instanceof Error ? err.message : "unknown delivery error" };
  }
}

export async function queueInvestigationNotification(input: QueueNotificationInput) {
  const [investigationCase, recipient] = await Promise.all([
    prisma.investigationCase.findFirst({ where: { id: input.caseId, tenantId: input.tenantId } }),
    prisma.user.findFirst({ where: { id: input.recipientUserId, tenantId: input.tenantId } }),
  ]);
  if (!investigationCase || !recipient) return null;

  let record;
  try {
    record = await prisma.investigationNotificationRecord.create({
      data: { tenantId: input.tenantId, caseId: input.caseId, eventType: input.eventType, recipientUserId: input.recipientUserId, status: "PENDING" },
    });
  } catch (error) {
    // A scheduled scan can race tenant/case lifecycle cleanup. Notification
    // delivery is best-effort and must not fail the job or business action.
    if (isConcurrentDeletion(error)) return null;
    throw error;
  }

  const now = new Date();
  const result = await attemptDelivery(recipient.email, recipient.name, investigationCase.caseNumber, investigationCase.title, input.eventType, input.message);

  try {
    return await prisma.investigationNotificationRecord.update({
      where: { id: record.id },
      data: result.delivered
        ? { status: "SENT", channel: getDefaultInvestigationNotificationProvider().channel, attemptedAt: now, deliveredAt: now, failureReason: null, attemptCount: 1, nextAttemptAt: null }
        : { status: "FAILED", channel: getDefaultInvestigationNotificationProvider().channel, attemptedAt: now, failureReason: result.failureReason ?? "delivery failed", attemptCount: 1, nextAttemptAt: nextRetryAt(now, 1) },
    });
  } catch (error) {
    if (isConcurrentDeletion(error)) return null;
    throw error;
  }
}

/** Re-attempts every FAILED notification — safe to run repeatedly, never changes case status. */
export async function retryFailedInvestigationNotifications(now: Date = new Date()) {
  const failed = await prisma.investigationNotificationRecord.findMany({
    where: { status: "FAILED", attemptCount: { lt: MAX_DELIVERY_ATTEMPTS }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    include: { case: true, recipient: true },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: NOTIFICATION_BATCH_SIZE,
  });

  let retried = 0;
  for (const record of failed) {
    if (!record.recipient || !record.case) {
      // A queued best-effort notification may outlive a synthetic/test user
      // or case cleanup. Exhaust it without crashing the tenant-wide retry
      // job or disclosing deleted recipient details.
      await prisma.investigationNotificationRecord.updateMany({
        where: { id: record.id, status: "FAILED" },
        data: { attemptCount: MAX_DELIVERY_ATTEMPTS, nextAttemptAt: null, failureReason: "recipient or case is no longer available" },
      });
      continue;
    }
    const result = await attemptDelivery(record.recipient.email, record.recipient.name, record.case.caseNumber, record.case.title, record.eventType, `Retry: ${record.eventType}`);
    const completedAttempts = record.attemptCount + 1;
    try {
      await prisma.investigationNotificationRecord.update({
        where: { id: record.id },
        data: result.delivered
          ? { status: "SENT", attemptedAt: now, deliveredAt: now, failureReason: null, attemptCount: completedAttempts, nextAttemptAt: null }
          : { status: "FAILED", attemptedAt: now, failureReason: result.failureReason ?? "delivery failed", attemptCount: completedAttempts, nextAttemptAt: nextRetryAt(now, completedAttempts) },
      });
      retried++;
    } catch (error) {
      if (!isConcurrentDeletion(error)) throw error;
    }
  }
  return { retried };
}

export async function listNotificationsForCase(tenantId: string, caseId: string) {
  return prisma.investigationNotificationRecord.findMany({ where: { tenantId, caseId }, orderBy: { createdAt: "desc" } });
}

/** Job entry point — notifies each overdue task's assignee. Deliberately queues every run rather than tracking "already notified today"; acceptable for this build's scope (documented in TESTING.md), and never touches case/task status. */
export async function notifyOverdueInvestigationTasks() {
  const overdue = await prisma.investigationTask.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() } },
    include: { case: true },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: NOTIFICATION_BATCH_SIZE,
  });
  let notified = 0;
  for (const task of overdue) {
    const record = await queueInvestigationNotification({
      tenantId: task.tenantId,
      caseId: task.caseId,
      eventType: "OVERDUE_TASK",
      recipientUserId: task.assignedToUserId,
      message: `Task overdue on case ${task.case.caseNumber}: ${task.description}`,
    });
    if (record) notified++;
  }
  return { notified };
}

/** Job entry point — notifies auditors whose grant expires within 3 days and hasn't already been flagged. */
export async function notifyExpiringExternalAccess(now: Date = new Date()) {
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const expiringGrants = await prisma.externalAuditorAccessGrant.findMany({
    where: { revokedAt: null, expiresAt: { gt: now, lte: soon } },
    include: { cases: true },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: NOTIFICATION_BATCH_SIZE,
  });
  let notified = 0;
  for (const grant of expiringGrants) {
    for (const gc of grant.cases) {
      const alreadyNotified = await prisma.investigationNotificationRecord.findFirst({
        where: { tenantId: grant.tenantId, eventType: "EXTERNAL_ACCESS_EXPIRING", recipientUserId: grant.externalAuditorUserId, caseId: gc.caseId },
      });
      if (alreadyNotified) continue;
      const record = await queueInvestigationNotification({
        tenantId: grant.tenantId,
        caseId: gc.caseId,
        eventType: "EXTERNAL_ACCESS_EXPIRING",
        recipientUserId: grant.externalAuditorUserId,
        message: `Your access to this case expires ${grant.expiresAt.toISOString()}.`,
      });
      if (record) notified++;
    }
  }
  return { notified };
}
