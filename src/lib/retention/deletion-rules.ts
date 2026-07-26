/**
 * Pure, DB-free retention/deletion decision logic (Phase 8C) — same "pure
 * module" pattern as lib/gate-events/state-machine.ts and
 * lib/telematics/geofence-engine.ts.
 */

export interface DeletableAssetLike {
  legalHold: boolean;
  investigationHold: boolean;
  /** Computed by the caller (DB-aware) — true if this evidence is linked to a GateEvent carrying an unresolved Exception. */
  hasUnresolvedLinkedException: boolean;
}

export interface DeletionEligibility {
  allowed: boolean;
  blockingReasons: string[];
}

/**
 * "Evidence under legal hold, investigation hold, an unresolved exception,
 * insurance claim, dispute or open audit cannot be deleted." This codebase
 * has no InsuranceClaim/Dispute/AuditCase model — MVP_SCOPE.md explicitly
 * scopes full investigation-case management out of this build — so those
 * three conditions cannot be programmatically checked and are **not**
 * enforced here. This is a disclosed, documented gap (TODO.md), not a
 * silent omission: legal hold, investigation hold, and an unresolved
 * exception linked to the evidence are the three conditions this codebase
 * can actually evaluate today.
 */
export function evaluateDeletionEligibility(asset: DeletableAssetLike): DeletionEligibility {
  const blockingReasons: string[] = [];
  if (asset.legalHold) blockingReasons.push("Under legal hold.");
  if (asset.investigationHold) blockingReasons.push("Under investigation hold.");
  if (asset.hasUnresolvedLinkedException) blockingReasons.push("Linked to an unresolved exception.");
  return { allowed: blockingReasons.length === 0, blockingReasons };
}

export function computeScheduledDeletionAt(capturedAt: Date, retentionDays: number): Date {
  return new Date(capturedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysUntil(scheduledDeletionAt: Date, now: Date): number {
  return Math.floor((scheduledDeletionAt.getTime() - now.getTime()) / MILLIS_PER_DAY);
}

export type RetentionNotificationMilestone = 90 | 60 | 30 | 7 | 0;
export const RETENTION_NOTIFICATION_MILESTONES: RetentionNotificationMilestone[] = [90, 60, 30, 7, 0];

/**
 * The single milestone that applies right now — the *tightest* (smallest)
 * threshold not yet exceeded — or `null` if expiry is more than 90 days
 * away, or already past (permanent deletion is a separate concern from a
 * "before expiry" notification). No real email/SMS is sent by this
 * function or anything that calls it — no notification provider exists yet
 * (INTEGRATIONS.md); this only computes *which* milestone applies, so the
 * system is "prepared for" each one per Phase 8C's requirement.
 */
export function currentRetentionMilestone(scheduledDeletionAt: Date, now: Date): RetentionNotificationMilestone | null {
  const daysLeft = daysUntil(scheduledDeletionAt, now);
  if (daysLeft < 0) return null;
  const applicable = RETENTION_NOTIFICATION_MILESTONES.filter((m) => daysLeft <= m);
  if (applicable.length === 0) return null;
  return Math.min(...applicable) as RetentionNotificationMilestone;
}
