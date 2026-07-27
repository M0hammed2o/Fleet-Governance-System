/**
 * Pure billing-period calendar helpers (P10D/L) — UTC calendar-month
 * boundaries. Documented simplification: periods are UTC month boundaries,
 * not the tenant's own IANA timezone (unlike vehicle-use-policy evaluation,
 * HARD-004) — a billing period spanning a few hours either side of a
 * tenant's local midnight at the month boundary has no material commercial
 * effect, and keeping this pure/timezone-free keeps invoice-period math
 * trivially testable. Revisit only if a real customer disputes a specific
 * boundary case.
 */

export interface BillingPeriodBounds {
  periodStart: Date;
  periodEnd: Date;
}

/** The UTC calendar month containing `reference` — periodEnd is exclusive (the first instant of the next month). */
export function getUtcMonthBounds(reference: Date): BillingPeriodBounds {
  const periodStart = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

/** "2026-07" — stable, locale-independent label for display/PDF. */
export function formatBillingPeriodLabel(periodStart: Date): string {
  const year = periodStart.getUTCFullYear();
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
