import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";

/**
 * A new, separately-scoped, fully audited mechanism for platform staff to
 * read a customer tenant's data — deliberately NOT an extension of
 * platform-tenant-repository.ts (see that file's own comment, D-005/D-016).
 * Two distinct layers:
 *   1. getCustomerHealthSummaries() (SUPPORT-001) — aggregate counts/status
 *      only, gated by the existing `platformTenant:VIEW`, no individual
 *      business records exposed.
 *   2. Everything else here (SUPPORT-002/003/004) — an actual, time-limited,
 *      audited SupportAccessSession must be active before
 *      getSupportViewForCustomer() will return anything about one specific
 *      customer tenant.
 */

// The one non-customer tenant in this system (see prisma/seed.ts) — never a
// valid target for a support-access session or the health-summary list.
const PLATFORM_TENANT_SLUG = "platform";

// Read-only by default (SUPPORT-003); a session's `elevated` flag records
// intent/authorisation for a change and is fully audited, but this phase
// does not itself wire elevation into write access on any customer
// resource — see DECISIONS.md D-021 and TODO.md.
const SUPPORT_ACCESS_SESSION_TTL_MINUTES = 60;

export class CustomerTenantNotFoundError extends Error {
  constructor() {
    super("Customer tenant not found.");
    this.name = "CustomerTenantNotFoundError";
  }
}
export class SupportAccessSessionNotFoundError extends Error {
  constructor() {
    super("Support access session not found.");
    this.name = "SupportAccessSessionNotFoundError";
  }
}
export class SupportAccessSessionNotActiveError extends Error {
  constructor() {
    super("No active support access session for this customer tenant — start one first.");
    this.name = "SupportAccessSessionNotActiveError";
  }
}
export class SupportAccessSessionAlreadyEndedError extends Error {
  constructor() {
    super("This support access session has already ended.");
    this.name = "SupportAccessSessionAlreadyEndedError";
  }
}
export class NotSessionActorError extends Error {
  constructor() {
    super("Only the user who started this support access session can end or elevate it.");
    this.name = "NotSessionActorError";
  }
}

// --- SUPPORT-001: customer health summary -----------------------------------

export interface CustomerHealthSummary {
  tenant: { id: string; name: string; slug: string; status: string; subscriptionStatus: string };
  siteCount: number;
  gateCount: number;
  vehicleCount: number;
  userCount: number;
  openCriticalExceptionCount: number;
  gpsActiveVehicleCount: number;
  facialVerificationEnrolledDriverCount: number;
  storageUsageBytes: number;
  lastActivityAt: Date | null;
  onboardingStatus: "NOT_STARTED" | "IN_PROGRESS" | "ACTIVE";
}

/**
 * Real DB-backed aggregate counts only — no individual business record
 * (no driver names, no vehicle registrations, no gate event detail) crosses
 * this boundary, keeping it safely viewable by any `platformTenant:VIEW`
 * holder without first starting an audited support-access session.
 */
export async function getCustomerHealthSummaries(session: AuthenticatedSession): Promise<CustomerHealthSummary[]> {
  await requirePermission(session, "platformTenant", "VIEW");

  const tenants = await prisma.tenant.findMany({ where: { slug: { not: PLATFORM_TENANT_SLUG } }, orderBy: { createdAt: "asc" } });

  const summaries = await Promise.all(
    tenants.map(async (tenant): Promise<CustomerHealthSummary> => {
      const [siteCount, gateCount, vehicleCount, userCount, openCriticalExceptionCount, gpsActiveVehicleCount, enrolledDriverCount, storageAgg, lastAudit] =
        await Promise.all([
          prisma.site.count({ where: { tenantId: tenant.id } }),
          prisma.gate.count({ where: { tenantId: tenant.id } }),
          prisma.vehicle.count({ where: { tenantId: tenant.id } }),
          prisma.user.count({ where: { tenantId: tenant.id } }),
          prisma.exception.count({ where: { tenantId: tenant.id, resolvedAt: null, severity: { in: ["HIGH", "CRITICAL"] } } }),
          prisma.vehicle.count({ where: { tenantId: tenant.id, gpsStatus: "ACTIVE" } }),
          prisma.driver.count({ where: { tenantId: tenant.id, facialVerificationEnrolled: true } }),
          prisma.mediaAsset.aggregate({ where: { tenantId: tenant.id }, _sum: { fileSizeBytes: true } }),
          prisma.auditLog.findFirst({ where: { tenantId: tenant.id }, orderBy: { timestamp: "desc" }, select: { timestamp: true } }),
        ]);

      const onboardingStatus: CustomerHealthSummary["onboardingStatus"] =
        siteCount === 0 ? "NOT_STARTED" : userCount <= 1 ? "IN_PROGRESS" : "ACTIVE";

      return {
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, subscriptionStatus: tenant.subscriptionStatus },
        siteCount,
        gateCount,
        vehicleCount,
        userCount,
        openCriticalExceptionCount,
        gpsActiveVehicleCount,
        facialVerificationEnrolledDriverCount: enrolledDriverCount,
        storageUsageBytes: storageAgg._sum.fileSizeBytes ?? 0,
        lastActivityAt: lastAudit?.timestamp ?? null,
        onboardingStatus,
      };
    }),
  );

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platform.supportAccess.healthSummaryViewed",
    entityType: "Tenant",
    entityId: "ALL",
  });

  return summaries;
}

// --- SUPPORT-002: SupportAccessSession lifecycle -----------------------------

export interface StartSupportAccessSessionInput {
  session: AuthenticatedSession;
  customerTenantId: string;
  reason: string;
  ticketReference?: string | null;
}

export async function startSupportAccessSession(input: StartSupportAccessSessionInput) {
  await requirePermission(input.session, "supportAccessSession", "CREATE");

  const customerTenant = await prisma.tenant.findUnique({ where: { id: input.customerTenantId } });
  if (!customerTenant || customerTenant.slug === PLATFORM_TENANT_SLUG) throw new CustomerTenantNotFoundError();

  const expiresAt = new Date(Date.now() + SUPPORT_ACCESS_SESSION_TTL_MINUTES * 60 * 1000);
  const accessSession = await prisma.supportAccessSession.create({
    data: {
      tenantId: input.session.tenantId,
      actorUserId: input.session.userId,
      customerTenantId: input.customerTenantId,
      reason: input.reason,
      ticketReference: input.ticketReference ?? null,
      expiresAt,
    },
  });

  await recordAudit({
    tenantId: input.session.tenantId,
    userId: input.session.userId,
    action: "platform.supportAccess.sessionStarted",
    entityType: "SupportAccessSession",
    entityId: accessSession.id,
    reason: input.reason,
    afterValue: { customerTenantId: input.customerTenantId, expiresAt },
  });

  return accessSession;
}

/** SUPPORT-003 "immediate exit action" — only the actor who started it may end it. */
export async function endSupportAccessSession(session: AuthenticatedSession, accessSessionId: string) {
  const accessSession = await prisma.supportAccessSession.findFirst({
    where: { id: accessSessionId, tenantId: session.tenantId },
  });
  if (!accessSession) return null;
  if (accessSession.actorUserId !== session.userId) throw new NotSessionActorError();
  if (accessSession.endedAt) throw new SupportAccessSessionAlreadyEndedError();

  const updated = await prisma.supportAccessSession.update({
    where: { id: accessSession.id },
    data: { endedAt: new Date() },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platform.supportAccess.sessionEnded",
    entityType: "SupportAccessSession",
    entityId: accessSession.id,
  });

  return updated;
}

export interface ElevateSupportAccessSessionInput {
  session: AuthenticatedSession;
  accessSessionId: string;
  elevatedReason: string;
}

/** SUPPORT-003 "explicit elevated-access workflow" — a second, deliberate action. */
export async function elevateSupportAccessSession(input: ElevateSupportAccessSessionInput) {
  await requirePermission(input.session, "supportAccessSession", "CONFIGURE");

  const accessSession = await prisma.supportAccessSession.findFirst({
    where: { id: input.accessSessionId, tenantId: input.session.tenantId },
  });
  if (!accessSession) return null;
  if (accessSession.actorUserId !== input.session.userId) throw new NotSessionActorError();
  if (accessSession.endedAt || accessSession.expiresAt < new Date()) throw new SupportAccessSessionNotActiveError();

  const updated = await prisma.supportAccessSession.update({
    where: { id: accessSession.id },
    data: { elevated: true, elevatedReason: input.elevatedReason, elevatedAt: new Date() },
  });

  await recordAudit({
    tenantId: input.session.tenantId,
    userId: input.session.userId,
    action: "platform.supportAccess.sessionElevated",
    entityType: "SupportAccessSession",
    entityId: accessSession.id,
    reason: input.elevatedReason,
  });

  return updated;
}

export async function getActiveSupportAccessSession(actorUserId: string, customerTenantId: string) {
  return prisma.supportAccessSession.findFirst({
    where: { actorUserId, customerTenantId, endedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { startedAt: "desc" },
  });
}

async function requireActiveSupportAccessSession(actorUserId: string, customerTenantId: string) {
  const active = await getActiveSupportAccessSession(actorUserId, customerTenantId);
  if (!active) throw new SupportAccessSessionNotActiveError();
  return active;
}

export async function listSupportAccessSessionsForCustomer(session: AuthenticatedSession, customerTenantId: string) {
  await requirePermission(session, "supportAccessSession", "VIEW");
  return prisma.supportAccessSession.findMany({
    where: { customerTenantId },
    orderBy: { startedAt: "desc" },
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
}

// --- SUPPORT-003: the controlled support view itself -------------------------

export interface SupportViewSummary {
  tenant: { id: string; name: string; slug: string; status: string; subscriptionStatus: string };
  sites: { id: string; name: string }[];
  gates: { id: string; name: string; siteName: string }[];
  vehicleCount: number;
  driverCount: number;
  openExceptions: { id: string; severity: string; description: string; raisedAt: Date }[];
  recentMovements: { id: string; referenceCode: string; status: string; movementType: string; createdAt: Date }[];
  notes: { id: string; note: string; authorName: string; createdAt: Date }[];
}

/**
 * Requires an active SupportAccessSession — this is the actual "support
 * view" (SUPPORT-003): a bounded, read-only summary of one customer tenant.
 * Deliberately excludes anything SUPPORT-003 names as off-limits by
 * default: no facial-verification enrolment detail, no raw MediaAsset/
 * evidence content, no investigation-case data (that module doesn't exist
 * yet regardless — explicitly out of scope for this build run).
 */
export async function getSupportViewForCustomer(session: AuthenticatedSession, customerTenantId: string): Promise<SupportViewSummary> {
  await requirePermission(session, "supportAccessSession", "VIEW");
  await requireActiveSupportAccessSession(session.userId, customerTenantId);

  const tenant = await prisma.tenant.findUnique({ where: { id: customerTenantId } });
  if (!tenant) throw new CustomerTenantNotFoundError();

  const [sites, gates, vehicleCount, driverCount, openExceptions, recentMovements, notes] = await Promise.all([
    prisma.site.findMany({ where: { tenantId: customerTenantId }, select: { id: true, name: true } }),
    prisma.gate.findMany({ where: { tenantId: customerTenantId }, select: { id: true, name: true, site: { select: { name: true } } } }),
    prisma.vehicle.count({ where: { tenantId: customerTenantId } }),
    prisma.driver.count({ where: { tenantId: customerTenantId } }),
    prisma.exception.findMany({
      where: { tenantId: customerTenantId, resolvedAt: null },
      orderBy: { raisedAt: "desc" },
      take: 20,
      select: { id: true, severity: true, description: true, raisedAt: true },
    }),
    prisma.movementAuthorisation.findMany({
      where: { tenantId: customerTenantId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, referenceCode: true, status: true, movementType: true, createdAt: true },
    }),
    prisma.supportNote.findMany({
      where: { customerTenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { author: { select: { name: true } } },
    }),
  ]);

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platform.supportAccess.customerViewOpened",
    entityType: "Tenant",
    entityId: customerTenantId,
  });

  return {
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, subscriptionStatus: tenant.subscriptionStatus },
    sites,
    gates: gates.map((g) => ({ id: g.id, name: g.name, siteName: g.site.name })),
    vehicleCount,
    driverCount,
    openExceptions,
    recentMovements,
    notes: notes.map((n) => ({ id: n.id, note: n.note, authorName: n.author.name, createdAt: n.createdAt })),
  };
}

// --- Support notes -----------------------------------------------------------

export async function createSupportNote(session: AuthenticatedSession, customerTenantId: string, note: string) {
  await requirePermission(session, "supportAccessSession", "CREATE");

  const tenant = await prisma.tenant.findUnique({ where: { id: customerTenantId } });
  if (!tenant) throw new CustomerTenantNotFoundError();

  const created = await prisma.supportNote.create({
    data: { tenantId: session.tenantId, customerTenantId, authorUserId: session.userId, note },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platform.supportAccess.noteAdded",
    entityType: "SupportNote",
    entityId: created.id,
    afterValue: { customerTenantId },
  });

  return created;
}
