import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { Prisma } from "@/generated/prisma/client";

type Notice = {
  id: string;
  category: string;
  severity: "INFO" | "WARNING" | "HIGH" | "CRITICAL";
  title: string;
  body: string;
  occurredAt: string;
  deepLink: string | null;
};

export async function listMobileNotifications(
  session: AuthenticatedSession,
  page = 1,
) {
  const canApproveMovement = await hasPermission(
    session,
    "movement",
    "APPROVE",
  );
  const canViewExceptions = await hasPermission(session, "exception", "VIEW");
  const canViewAnalytics = await hasPermission(
    session,
    "analyticsIndicator",
    "VIEW",
  );
  const canViewTelematics = await hasPermission(session, "telematics", "VIEW");
  const [movements, exceptions, indicators, staleVehicles] = await Promise.all([
    canApproveMovement
      ? prisma.movementAuthorisation.findMany({
          where: tenantWhere(session.tenantId, {
            status: "SUBMITTED",
          } satisfies Prisma.MovementAuthorisationWhereInput),
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: { id: true, referenceCode: true, updatedAt: true },
        })
      : Promise.resolve([]),
    canViewExceptions
      ? prisma.exception.findMany({
          where: tenantWhere(session.tenantId, {
            resolvedAt: null,
          } satisfies Prisma.ExceptionWhereInput),
          orderBy: { raisedAt: "desc" },
          take: 50,
          select: {
            id: true,
            description: true,
            severity: true,
            raisedAt: true,
            gateEventId: true,
          },
        })
      : Promise.resolve([]),
    canViewAnalytics
      ? prisma.analyticsIndicator.findMany({
          where: tenantWhere(session.tenantId, {
            status: { not: "DISMISSED" },
          } satisfies Prisma.AnalyticsIndicatorWhereInput),
          orderBy: { lastDetectedAt: "desc" },
          take: 50,
          select: {
            id: true,
            title: true,
            severity: true,
            lastDetectedAt: true,
          },
        })
      : Promise.resolve([]),
    canViewTelematics
      ? prisma.vehicle.findMany({
          where: tenantWhere(session.tenantId, {
            archivedAt: null,
            OR: [{ gpsStatus: "INACTIVE" }, { gpsLastCommunicationAt: null }],
          } satisfies Prisma.VehicleWhereInput),
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: { id: true, registrationNumber: true, updatedAt: true },
        })
      : Promise.resolve([]),
  ]);
  const notices: Notice[] = [
    ...movements.map((item) => ({
      id: `movement-approval:${item.id}`,
      category: "MOVEMENT_AWAITING_APPROVAL",
      severity: "WARNING" as const,
      title: "Movement awaiting approval",
      body: `Movement ${item.referenceCode} requires an authorized decision.`,
      occurredAt: item.updatedAt.toISOString(),
      deepLink: `/owner/movements/${item.id}`,
    })),
    ...exceptions.map((item) => ({
      id: `exception:${item.id}`,
      category: "GATE_EXCEPTION",
      severity:
        item.severity === "CRITICAL"
          ? ("CRITICAL" as const)
          : item.severity === "HIGH"
            ? ("HIGH" as const)
            : ("WARNING" as const),
      title: "Open gate exception",
      body: item.description.slice(0, 180),
      occurredAt: item.raisedAt.toISOString(),
      deepLink: item.gateEventId ? `/guard/events/${item.gateEventId}` : null,
    })),
    ...indicators.map((item) => ({
      id: `indicator:${item.id}`,
      category: "GOVERNANCE_INDICATOR",
      severity:
        item.severity === "CRITICAL"
          ? ("CRITICAL" as const)
          : item.severity === "HIGH"
            ? ("HIGH" as const)
            : ("INFO" as const),
      title: "Governance indicator",
      body: item.title,
      occurredAt: item.lastDetectedAt.toISOString(),
      deepLink: `/owner/indicators/${item.id}`,
    })),
    ...staleVehicles.map((item) => ({
      id: `tracker:${item.id}`,
      category: "TRACKER_UNAVAILABLE",
      severity: "WARNING" as const,
      title: "Tracker unavailable",
      body: `Tracker availability for ${item.registrationNumber} requires review; unavailability is not wrongdoing.`,
      occurredAt: item.updatedAt.toISOString(),
      deepLink: `/owner/vehicles/${item.id}`,
    })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const states = await prisma.mobileNotificationState.findMany({
    where: {
      tenantId: session.tenantId,
      userId: session.userId,
      notificationKey: { in: notices.map((item) => item.id) },
    },
    select: { notificationKey: true, readAt: true },
  });
  const read = new Map(
    states.map((state) => [state.notificationKey, Boolean(state.readAt)]),
  );
  const pageSize = 20;
  const safePage = Math.max(1, page);
  const items = notices
    .slice((safePage - 1) * pageSize, safePage * pageSize)
    .map((notice) => ({ ...notice, read: read.get(notice.id) ?? false }));
  return { items, total: notices.length, page: safePage, pageSize };
}

export async function markMobileNotificationRead(
  session: AuthenticatedSession,
  notificationKey: string,
) {
  const current = await listMobileNotifications(session, 1);
  const allCurrent =
    current.total <= current.pageSize
      ? current.items
      : (
          await Promise.all(
            Array.from(
              { length: Math.ceil(current.total / current.pageSize) },
              (_, index) => listMobileNotifications(session, index + 1),
            ),
          )
        ).flatMap((page) => page.items);
  if (!allCurrent.some((item) => item.id === notificationKey)) return false;
  await prisma.mobileNotificationState.upsert({
    where: {
      tenantId_userId_notificationKey: {
        tenantId: session.tenantId,
        userId: session.userId,
        notificationKey,
      },
    },
    create: {
      tenantId: session.tenantId,
      userId: session.userId,
      notificationKey,
      readAt: new Date(),
    },
    update: { readAt: new Date() },
  });
  return true;
}
