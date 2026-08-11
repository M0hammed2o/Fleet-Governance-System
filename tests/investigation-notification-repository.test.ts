import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  assignInvestigator,
  createInvestigationCase,
  createInvestigationTask,
} from "@/lib/repositories/investigation-case-repository";
import {
  listNotificationsForCase,
  notifyExpiringExternalAccess,
  notifyOverdueInvestigationTasks,
  queueInvestigationNotification,
  retryFailedInvestigationNotifications,
} from "@/lib/repositories/investigation-notification-repository";
import { grantExternalAuditorAccess } from "@/lib/repositories/external-auditor-access-repository";
import { createTenant } from "./helpers/fixtures";
import { makeExternalAuditorSessionForTenant, makeManagerSessionForTenant } from "./helpers/investigation-fixtures";

describe("investigation notifications and scheduled jobs", () => {
  it("records assignment delivery failure through the default NOOP provider without changing case status", async () => {
    const tenant = await createTenant("Assignment notification");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: investigator } = await makeManagerSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(manager, { title: "Assignment", description: "Neutral", source: "MANUAL_CONCERN" });

    await assignInvestigator(manager, investigationCase.id, investigator.userId);
    const records = await listNotificationsForCase(tenant.id, investigationCase.id);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ eventType: "ASSIGNMENT", recipientUserId: investigator.userId, status: "FAILED", channel: "NOOP" });
    expect((await prisma.investigationCase.findUniqueOrThrow({ where: { id: investigationCase.id } })).status).toBe("DRAFT");
  }, 90_000);

  it("retries failed notifications and preserves the triggering case state even when NOOP fails again", async () => {
    const tenant = await createTenant("Notification retry");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(manager, { title: "Retry", description: "Neutral", source: "MANUAL_CONCERN" });
    const record = await queueInvestigationNotification({
      tenantId: tenant.id,
      caseId: investigationCase.id,
      eventType: "INFORMATION_REQUESTED",
      recipientUserId: manager.userId,
      message: "Please provide more information.",
    });
    expect(record?.status).toBe("FAILED");

    const result = await retryFailedInvestigationNotifications();
    expect(result.retried).toBeGreaterThanOrEqual(1);
    const afterRetry = await prisma.investigationNotificationRecord.findUniqueOrThrow({ where: { id: record!.id } });
    expect(afterRetry).toMatchObject({ status: "FAILED", attemptCount: 2 });
    const finalAttemptAt = new Date(afterRetry.nextAttemptAt!.getTime() + 1);
    await retryFailedInvestigationNotifications(finalAttemptAt);
    const exhausted = await prisma.investigationNotificationRecord.findUniqueOrThrow({ where: { id: record!.id } });
    expect(exhausted).toMatchObject({ status: "FAILED", attemptCount: 3, nextAttemptAt: null });
    expect((await retryFailedInvestigationNotifications(new Date(finalAttemptAt.getTime() + 60_000))).retried).toBe(0);
    expect((await prisma.investigationCase.findUniqueOrThrow({ where: { id: investigationCase.id } })).status).toBe("DRAFT");
  }, 90_000);

  it("notifies overdue-task assignees without completing the task or moving the case", async () => {
    const tenant = await createTenant("Overdue notification");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(manager, { title: "Overdue", description: "Neutral", source: "MANUAL_CONCERN" });
    const task = await createInvestigationTask(manager, investigationCase.id, {
      description: "Obtain statement",
      assignedToUserId: manager.userId,
      dueDate: new Date(Date.now() - 60_000),
    });

    expect((await notifyOverdueInvestigationTasks()).notified).toBeGreaterThanOrEqual(1);
    expect(await prisma.investigationNotificationRecord.count({ where: { caseId: investigationCase.id, eventType: "OVERDUE_TASK" } })).toBe(1);
    expect((await prisma.investigationTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("OPEN");
    expect((await prisma.investigationCase.findUniqueOrThrow({ where: { id: investigationCase.id } })).status).toBe("DRAFT");
  });

  it("notifies every case on an expiring grant exactly once", async () => {
    const tenant = await createTenant("Expiring access");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const auditor = await makeExternalAuditorSessionForTenant(tenant);
    const caseA = await createInvestigationCase(manager, { title: "A", description: "A", source: "MANUAL_CONCERN" });
    const caseB = await createInvestigationCase(manager, { title: "B", description: "B", source: "MANUAL_CONCERN" });
    const now = new Date();
    await grantExternalAuditorAccess(manager, {
      externalAuditorUserId: auditor.user.id,
      caseIds: [caseA.id, caseB.id],
      reason: "Short assurance window",
      expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
    });

    await notifyExpiringExternalAccess(now);
    await notifyExpiringExternalAccess(now);
    expect(
      await prisma.investigationNotificationRecord.count({
        where: { tenantId: tenant.id, eventType: "EXTERNAL_ACCESS_EXPIRING", caseId: { in: [caseA.id, caseB.id] } },
      }),
    ).toBe(2);
  });

  it("refuses to create a notification record when case and recipient do not match the supplied tenant", async () => {
    const tenantA = await createTenant("Notification A");
    const tenantB = await createTenant("Notification B");
    const { session: managerA } = await makeManagerSessionForTenant(tenantA);
    const { session: managerB } = await makeManagerSessionForTenant(tenantB);
    const caseA = await createInvestigationCase(managerA, { title: "A", description: "A", source: "MANUAL_CONCERN" });

    await expect(
      queueInvestigationNotification({
        tenantId: tenantA.id,
        caseId: caseA.id,
        eventType: "ASSIGNMENT",
        recipientUserId: managerB.userId,
        message: "Cross-tenant attempt",
      }),
    ).resolves.toBeNull();
  });
});
