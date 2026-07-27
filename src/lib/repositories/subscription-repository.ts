import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { SubscriptionStatus } from "@/generated/prisma/client";
import { getTenantBillingProfileUnchecked } from "@/lib/repositories/tenant-billing-repository";
import { getPlatformBillingSettingsUnchecked } from "@/lib/repositories/platform-billing-repository";

/**
 * Phase 10 (P10A/K) — subscription lifecycle state, distinct from the
 * legacy `Tenant.subscriptionStatus` manual flag kept for SUPPORT-001
 * backward compatibility (D-035). ACTIVE = normal access. PAST_DUE = an
 * invoice is overdue but still within the tenant's grace period — a clear
 * billing warning, no access restriction. SUSPENDED = grace period
 * elapsed and a platform admin (or the automated policy below) suspended
 * access.
 *
 * Continuity-mode decision (documented in DECISIONS.md and
 * BILLING_AND_SUBSCRIPTIONS.md): suspension for non-payment NEVER blocks
 * gate operations, evidence capture, exception handling, or any existing
 * safety-critical workflow — those must never silently create a safety
 * risk for a customer that stops paying. The only access this module
 * actually gates is *creating a new Movement* (i.e. starting new business),
 * enforced in movement-repository.ts's createMovement(). Gate check-in/
 * check-out for movements already in flight, evidence capture, exceptions,
 * and every other Phase 1-9 workflow remain fully available regardless of
 * subscription status. The tenant's own Accountant / designated
 * administrator and Platform Administrator always retain access to billing
 * screens to resolve payment (they only ever needed tenantBilling/invoice/
 * payment/tenantSubscription permissions, none of which this module
 * touches).
 */

const STANDARD_PLAN_NAME = "Standard";

async function getOrCreateStandardPlan() {
  try {
    return await prisma.subscriptionPlan.upsert({
      where: { name: STANDARD_PLAN_NAME },
      update: {},
      create: { name: STANDARD_PLAN_NAME, description: "The platform's single V1 commercial plan — base fee plus per-active-vehicle fee." },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "name")) {
      return prisma.subscriptionPlan.findUniqueOrThrow({ where: { name: STANDARD_PLAN_NAME } });
    }
    throw err;
  }
}

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002" && JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target);
}

/**
 * Ensures a tenant has a TenantSubscription row, creating a PENDING one
 * against the Standard plan on first access — never a null "not
 * subscribed yet" state elsewhere in this module. The check-then-create
 * has a genuine race window under real concurrency (two callers can both
 * see "no row exists" before either commits); caught and resolved by
 * re-fetching the row the other caller just created, same pattern used
 * throughout the Phase 10 repositories.
 */
export async function ensureTenantSubscription(tenantId: string) {
  const existing = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
  if (existing) return existing;

  const plan = await getOrCreateStandardPlan();
  try {
    return await prisma.tenantSubscription.create({ data: { tenantId, planId: plan.id, status: "PENDING" } });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "tenantId")) {
      return prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    }
    throw err;
  }
}

export async function getTenantSubscription(session: AuthenticatedSession, tenantId: string) {
  await requirePermission(session, "tenantSubscription", "VIEW");
  return ensureTenantSubscription(tenantId);
}

export async function getTenantSubscriptionUnchecked(tenantId: string) {
  return ensureTenantSubscription(tenantId);
}

export class InvalidSubscriptionTransitionError extends Error {
  constructor(from: SubscriptionStatus, to: SubscriptionStatus) {
    super(`Cannot transition a subscription from ${from} to ${to}.`);
    this.name = "InvalidSubscriptionTransitionError";
  }
}

/** Activates a PENDING subscription — called once a tenant's first billing period/invoice exists, or explicitly by a platform admin. */
export async function activateTenantSubscription(tenantId: string, actorUserId: string | null) {
  const subscription = await ensureTenantSubscription(tenantId);
  if (subscription.status === "ACTIVE") return subscription;
  if (subscription.status === "CANCELLED") throw new InvalidSubscriptionTransitionError(subscription.status, "ACTIVE");

  const updated = await prisma.tenantSubscription.update({
    where: { tenantId },
    data: { status: "ACTIVE", startedAt: subscription.startedAt ?? new Date() },
  });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "tenantSubscription.activated",
    entityType: "TenantSubscription",
    entityId: updated.id,
    beforeValue: { status: subscription.status },
    afterValue: { status: updated.status },
  });

  return updated;
}

/** Marks a subscription PAST_DUE — called by the recurring billing job when an invoice becomes overdue (P10L). Never blocks access by itself; only a clear warning. */
export async function markTenantPastDue(tenantId: string, actorUserId: string | null) {
  const subscription = await ensureTenantSubscription(tenantId);
  if (subscription.status !== "ACTIVE") return subscription;

  const updated = await prisma.tenantSubscription.update({ where: { tenantId }, data: { status: "PAST_DUE" } });

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: "tenantSubscription.pastDue",
    entityType: "TenantSubscription",
    entityId: updated.id,
    beforeValue: { status: subscription.status },
    afterValue: { status: updated.status },
  });

  return updated;
}

export class TenantSubscriptionNotPastDueError extends Error {
  constructor() {
    super("Only a PAST_DUE subscription can be suspended.");
    this.name = "TenantSubscriptionNotPastDueError";
  }
}

/**
 * Suspends access (P10K). `actorUserId: null` records an automated
 * suspension (the configurable grace-period policy below); a non-null
 * value is an explicit Platform Administrator action via the billing
 * dashboard — both are equally audited.
 */
export async function suspendTenantSubscription(tenantId: string, reason: string, actorSession: AuthenticatedSession | null) {
  if (actorSession) await requirePermission(actorSession, "tenantSubscription", "CONFIGURE");

  const subscription = await ensureTenantSubscription(tenantId);
  if (subscription.status !== "PAST_DUE") throw new TenantSubscriptionNotPastDueError();

  const updated = await prisma.tenantSubscription.update({
    where: { tenantId },
    data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: reason, suspendedByUserId: actorSession?.userId ?? null },
  });

  await recordAudit({
    tenantId,
    userId: actorSession?.userId ?? null,
    action: "tenantSubscription.suspended",
    entityType: "TenantSubscription",
    entityId: updated.id,
    beforeValue: { status: subscription.status },
    afterValue: { status: updated.status, reason },
    reason,
  });

  return updated;
}

export class TenantSubscriptionNotSuspendedOrPastDueError extends Error {
  constructor() {
    super("Only a SUSPENDED or PAST_DUE subscription can be restored to ACTIVE.");
    this.name = "TenantSubscriptionNotSuspendedOrPastDueError";
  }
}

/** Restores full access (P10K). `actorUserId: null` records an automated restoration (all overdue invoices resolved by payment); a non-null value is an explicit platform-admin action. */
export async function restoreTenantSubscription(tenantId: string, actorSession: AuthenticatedSession | null) {
  if (actorSession) await requirePermission(actorSession, "tenantSubscription", "CONFIGURE");

  const subscription = await ensureTenantSubscription(tenantId);
  if (subscription.status !== "SUSPENDED" && subscription.status !== "PAST_DUE") throw new TenantSubscriptionNotSuspendedOrPastDueError();

  const updated = await prisma.tenantSubscription.update({
    where: { tenantId },
    data: { status: "ACTIVE", restoredAt: new Date(), restoredByUserId: actorSession?.userId ?? null },
  });

  await recordAudit({
    tenantId,
    userId: actorSession?.userId ?? null,
    action: "tenantSubscription.restored",
    entityType: "TenantSubscription",
    entityId: updated.id,
    beforeValue: { status: subscription.status },
    afterValue: { status: updated.status },
  });

  return updated;
}

/**
 * Configurable grace-period policy (P10K "automated suspension behind a
 * configurable, tested policy"): a PAST_DUE tenant is eligible for
 * automated suspension once `gracePeriodDays` (the tenant's own
 * TenantBillingProfile override, falling back to the platform default)
 * have elapsed since `oldestOverdueDueDate`. Pure function — no I/O — so
 * it's directly unit-testable without a database.
 */
export function isEligibleForAutomatedSuspension(oldestOverdueDueDate: Date, gracePeriodDays: number, now: Date = new Date()): boolean {
  const graceEndsAt = new Date(oldestOverdueDueDate.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
  return now.getTime() >= graceEndsAt.getTime();
}

async function getGracePeriodDaysForTenant(tenantId: string): Promise<number> {
  const [profile, settings] = await Promise.all([getTenantBillingProfileUnchecked(tenantId), getPlatformBillingSettingsUnchecked()]);
  return profile?.gracePeriodDays ?? settings.defaultGracePeriodDays;
}

/**
 * Applies the automated-suspension policy for one tenant currently
 * PAST_DUE, given its oldest unpaid (OVERDUE) invoice's due date. Called by
 * the recurring billing job (P10L), never by an interactive request — an
 * automated suspension is always `actorUserId: null`.
 */
export async function evaluateAutomatedSuspension(tenantId: string, oldestOverdueDueDate: Date, now: Date = new Date()): Promise<boolean> {
  const subscription = await ensureTenantSubscription(tenantId);
  if (subscription.status !== "PAST_DUE") return false;

  const gracePeriodDays = await getGracePeriodDaysForTenant(tenantId);
  if (!isEligibleForAutomatedSuspension(oldestOverdueDueDate, gracePeriodDays, now)) return false;

  await suspendTenantSubscription(tenantId, "Automated suspension: grace period elapsed with an unpaid overdue invoice.", null);
  return true;
}

/**
 * Sweeps every PAST_DUE tenant and applies the automated-suspension policy
 * (P10L, called by the recurring billing job) — for each, finds its oldest
 * unpaid OVERDUE invoice's due date and defers to
 * `evaluateAutomatedSuspension()`. A tenant with no OVERDUE invoice at all
 * (e.g. PAST_DUE was set but the invoice was since voided) is safely
 * skipped, not suspended on stale state.
 */
export async function evaluateAutomatedSuspensionsForAllPastDueTenants(now: Date = new Date()): Promise<number> {
  const pastDueSubscriptions = await prisma.tenantSubscription.findMany({ where: { status: "PAST_DUE" } });
  let suspendedCount = 0;
  for (const subscription of pastDueSubscriptions) {
    const oldestOverdue = await prisma.invoice.findFirst({ where: { tenantId: subscription.tenantId, status: "OVERDUE" }, orderBy: { dueDate: "asc" } });
    if (!oldestOverdue) continue;
    const suspended = await evaluateAutomatedSuspension(subscription.tenantId, oldestOverdue.dueDate, now);
    if (suspended) suspendedCount++;
  }
  return suspendedCount;
}

export type TenantAccessStatus = "ACTIVE" | "PENDING" | "PAST_DUE_WARNING" | "SUSPENDED" | "CANCELLED";

export interface TenantAccessStatusResult {
  status: TenantAccessStatus;
  subscriptionStatus: SubscriptionStatus;
  /** True only for SUSPENDED — the one access boundary this module enforces (see module docstring). Never true for PAST_DUE. */
  blocksNewMovementCreation: boolean;
}

/** No permission check — read internally by createMovement()'s guard and by dashboards that have already established their own authorisation. */
export async function getTenantAccessStatus(tenantId: string): Promise<TenantAccessStatusResult> {
  const subscription = await ensureTenantSubscription(tenantId);
  const statusMap: Record<SubscriptionStatus, TenantAccessStatus> = {
    PENDING: "PENDING",
    ACTIVE: "ACTIVE",
    PAST_DUE: "PAST_DUE_WARNING",
    SUSPENDED: "SUSPENDED",
    CANCELLED: "CANCELLED",
  };
  return {
    status: statusMap[subscription.status],
    subscriptionStatus: subscription.status,
    blocksNewMovementCreation: subscription.status === "SUSPENDED",
  };
}
