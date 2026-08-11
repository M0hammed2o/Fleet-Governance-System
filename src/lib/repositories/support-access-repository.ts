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
 *
 * Deliberately computed as one grouped query per metric (`groupBy tenantId`),
 * not a `Promise.all` fan-out of ~9 queries *per tenant* — the platform can
 * hold hundreds of customer tenants, and firing that many concurrent queries
 * at once saturates the connection pool and triggers pg's "client already
 * executing a query" deprecation path (observed as intermittent test
 * timeouts once enough fixture tenants had accumulated — see WORKLOG.md
 * Phase 8A). This keeps the query count constant (9 total) regardless of
 * how many tenants exist.
 */
export async function getCustomerHealthSummaries(session: AuthenticatedSession): Promise<CustomerHealthSummary[]> {
  await requirePermission(session, "platformTenant", "VIEW");

  const tenants = await prisma.tenant.findMany({ where: { slug: { not: PLATFORM_TENANT_SLUG } }, orderBy: { createdAt: "asc" } });
  const tenantIds = tenants.map((t) => t.id);

  const [siteCounts, gateCounts, vehicleCounts, userCounts, openCriticalExceptionCounts, gpsActiveVehicleCounts, enrolledDriverCounts, storageSums, lastAudits] =
    await Promise.all([
      prisma.site.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
      prisma.gate.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
      prisma.vehicle.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
      prisma.user.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
      prisma.exception.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds }, resolvedAt: null, severity: { in: ["HIGH", "CRITICAL"] } },
        _count: { _all: true },
      }),
      prisma.vehicle.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, gpsStatus: "ACTIVE" }, _count: { _all: true } }),
      prisma.driver.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, facialVerificationEnrolled: true }, _count: { _all: true } }),
      prisma.mediaAsset.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, _sum: { fileSizeBytes: true } }),
      prisma.auditLog.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, _max: { timestamp: true } }),
    ]);

  const toCountMap = (rows: Array<{ tenantId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.tenantId, r._count._all]));
  const siteCountByTenant = toCountMap(siteCounts);
  const gateCountByTenant = toCountMap(gateCounts);
  const vehicleCountByTenant = toCountMap(vehicleCounts);
  const userCountByTenant = toCountMap(userCounts);
  const openCriticalExceptionCountByTenant = toCountMap(openCriticalExceptionCounts);
  const gpsActiveVehicleCountByTenant = toCountMap(gpsActiveVehicleCounts);
  const enrolledDriverCountByTenant = toCountMap(enrolledDriverCounts);
  const storageBytesByTenant = new Map(storageSums.map((r) => [r.tenantId, r._sum.fileSizeBytes ?? 0]));
  const lastActivityByTenant = new Map(lastAudits.map((r) => [r.tenantId, r._max.timestamp ?? null]));

  const summaries: CustomerHealthSummary[] = tenants.map((tenant): CustomerHealthSummary => {
    const siteCount = siteCountByTenant.get(tenant.id) ?? 0;
    const userCount = userCountByTenant.get(tenant.id) ?? 0;
    const onboardingStatus: CustomerHealthSummary["onboardingStatus"] =
      siteCount === 0 ? "NOT_STARTED" : userCount <= 1 ? "IN_PROGRESS" : "ACTIVE";

    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, subscriptionStatus: tenant.subscriptionStatus },
      siteCount,
      gateCount: gateCountByTenant.get(tenant.id) ?? 0,
      vehicleCount: vehicleCountByTenant.get(tenant.id) ?? 0,
      userCount,
      openCriticalExceptionCount: openCriticalExceptionCountByTenant.get(tenant.id) ?? 0,
      gpsActiveVehicleCount: gpsActiveVehicleCountByTenant.get(tenant.id) ?? 0,
      facialVerificationEnrolledDriverCount: enrolledDriverCountByTenant.get(tenant.id) ?? 0,
      storageUsageBytes: storageBytesByTenant.get(tenant.id) ?? 0,
      lastActivityAt: lastActivityByTenant.get(tenant.id) ?? null,
      onboardingStatus,
    };
  });

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

/**
 * Background job (8E-004): closes out any SupportAccessSession whose TTL
 * has lapsed without an explicit endSupportAccessSession() call. Today,
 * expiry is only enforced *lazily* — getActiveSupportAccessSession() and
 * every check built on it already treat `expiresAt < now` as inactive
 * (see requireActiveSupportAccessSession() above) — so this job doesn't
 * change any access-control outcome; it exists so `endedAt` becomes an
 * honest, queryable record of "this session is over" for anyone auditing
 * SupportAccessSession rows directly, instead of only ever being set by a
 * platform-staff member remembering to click "end session". Idempotent:
 * only ever touches rows with `endedAt: null`, so re-running finds nothing
 * left once a session is closed out.
 */
export async function expireDueSupportAccessSessions(now: Date = new Date(), customerTenantId?: string): Promise<{ expiredCount: number }> {
  const due = await prisma.supportAccessSession.findMany({
    where: { ...(customerTenantId ? { customerTenantId } : {}), endedAt: null, expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 200,
  });

  for (const session of due) {
    await prisma.supportAccessSession.update({ where: { id: session.id }, data: { endedAt: session.expiresAt } });
    await recordAudit({
      tenantId: session.tenantId,
      userId: session.actorUserId,
      action: "platform.supportAccess.sessionAutoExpired",
      entityType: "SupportAccessSession",
      entityId: session.id,
      reason: "TTL elapsed without an explicit end action",
    });
  }

  return { expiredCount: due.length };
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
