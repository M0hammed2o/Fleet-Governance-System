import "server-only";
import { prisma } from "@/lib/db/prisma";
import { getDefaultInvestigationNotificationProvider } from "@/lib/investigations/investigation-notification-provider";
import type { InvestigationNotificationEventType } from "@/generated/prisma/client";

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
    prisma.investigationCase.findUnique({ where: { id: input.caseId } }),
    prisma.user.findUnique({ where: { id: input.recipientUserId } }),
  ]);
  if (!investigationCase || !recipient) return null;

  const record = await prisma.investigationNotificationRecord.create({
    data: { tenantId: input.tenantId, caseId: input.caseId, eventType: input.eventType, recipientUserId: input.recipientUserId, status: "PENDING" },
  });

  const now = new Date();
  const result = await attemptDelivery(recipient.email, recipient.name, investigationCase.caseNumber, investigationCase.title, input.eventType, input.message);

  return prisma.investigationNotificationRecord.update({
    where: { id: record.id },
    data: result.delivered
      ? { status: "SENT", channel: getDefaultInvestigationNotificationProvider().channel, attemptedAt: now, deliveredAt: now, failureReason: null }
      : { status: "FAILED", channel: getDefaultInvestigationNotificationProvider().channel, attemptedAt: now, failureReason: result.failureReason ?? "delivery failed" },
  });
}

/** Re-attempts every FAILED notification — safe to run repeatedly, never changes case status. */
export async function retryFailedInvestigationNotifications() {
  const failed = await prisma.investigationNotificationRecord.findMany({
    where: { status: "FAILED" },
    include: { case: true, recipient: true },
  });

  let retried = 0;
  for (const record of failed) {
    const now = new Date();
    const result = await attemptDelivery(record.recipient.email, record.recipient.name, record.case.caseNumber, record.case.title, record.eventType, `Retry: ${record.eventType}`);
    await prisma.investigationNotificationRecord.update({
      where: { id: record.id },
      data: result.delivered
        ? { status: "SENT", attemptedAt: now, deliveredAt: now, failureReason: null }
        : { status: "FAILED", attemptedAt: now, failureReason: result.failureReason ?? "delivery failed" },
    });
    retried++;
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
  });
  let notified = 0;
  for (const task of overdue) {
    await queueInvestigationNotification({
      tenantId: task.tenantId,
      caseId: task.caseId,
      eventType: "OVERDUE_TASK",
      recipientUserId: task.assignedToUserId,
      message: `Task overdue on case ${task.case.caseNumber}: ${task.description}`,
    });
    notified++;
  }
  return { notified };
}

/** Job entry point — notifies auditors whose grant expires within 3 days and hasn't already been flagged. */
export async function notifyExpiringExternalAccess(now: Date = new Date()) {
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const expiringGrants = await prisma.externalAuditorAccessGrant.findMany({
    where: { revokedAt: null, expiresAt: { gt: now, lte: soon } },
    include: { cases: true },
  });
  let notified = 0;
  for (const grant of expiringGrants) {
    const alreadyNotified = await prisma.investigationNotificationRecord.findFirst({
      where: { tenantId: grant.tenantId, eventType: "EXTERNAL_ACCESS_EXPIRING", recipientUserId: grant.externalAuditorUserId, caseId: { in: grant.cases.map((c) => c.caseId) } },
    });
    if (alreadyNotified) continue;
    for (const gc of grant.cases) {
      await queueInvestigationNotification({
        tenantId: grant.tenantId,
        caseId: gc.caseId,
        eventType: "EXTERNAL_ACCESS_EXPIRING",
        recipientUserId: grant.externalAuditorUserId,
        message: `Your access to this case expires ${grant.expiresAt.toISOString()}.`,
      });
      notified++;
    }
  }
  return { notified };
}
