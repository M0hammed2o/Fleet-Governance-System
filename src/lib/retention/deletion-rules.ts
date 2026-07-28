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
 * insurance claim, dispute or open audit cannot be deleted." Phase 11
 * (P11G) closed the investigation-hold half of this gap: opening a case
 * sets InvestigationCase.evidenceHoldActive, and every evidence item linked
 * to that case has MediaAsset.investigationHold driven from it (see
 * investigation-evidence-repository.ts / investigation-hold-repository.ts)
 * — so `investigationHold` below is no longer only a manually-toggled flag.
 * This codebase still has no InsuranceClaim/Dispute model, so those two
 * conditions remain out of scope and are **not** enforced here — a
 * disclosed, documented gap (TODO.md), not a silent omission.
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
