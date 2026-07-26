/**
 * Pure, DB-free distance-accumulation engine — same "pure module" pattern as
 * lib/telematics/geofence-engine.ts. Computes per-trip/daily/weekly/monthly
 * distance travelled from a vehicle's ordered TelematicsEvent odometer
 * readings, so `evaluatePolicyCompliance()`'s km-limit checks are real
 * numbers instead of the previously-hardcoded `null` (see TODO.md's
 * "Per-trip distance accumulation" item and ARCHITECTURE.md "Telematics
 * architecture", both closed by this module — Phase 8A).
 *
 * A missing/undeterminable distance is always `null` ("not enough data to
 * know"), never `0` — a km-limit check against a fabricated zero could
 * silently hide a real violation, so the caller must treat `null` as "skip
 * this check" (same convention as `MovementAuthorisation.expectedDistanceKm`
 * and D-020's telematics exceptions).
 */

import type { DistanceSoFar } from "./geofence-engine";

export interface OdometerReading {
  recordedAt: Date;
  odometerKm: number | null;
  ignitionOn: boolean | null;
}

/** Converts a wall-clock date/time in `timeZone` to the UTC instant it represents. */
function zonedWallClockToUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const driftMs = asIfUtc - guess.getTime();
  return new Date(guess.getTime() - driftMs);
}

function wallClockDateParts(date: Date, timeZone: string): { year: number; month: number; day: number; dayOfWeek: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekdayToNumber: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayOfWeek: weekdayToNumber[parts.weekday ?? ""] ?? date.getUTCDay(),
  };
}

/** Midnight (00:00:00) at the start of `date`'s calendar day, in `timeZone`. */
export function startOfDayInTimeZone(date: Date, timeZone: string): Date {
  const { year, month, day } = wallClockDateParts(date, timeZone);
  return zonedWallClockToUtc(year, month, day, timeZone);
}

/** Midnight at the start of `date`'s calendar week (Sunday, matching `permittedDaysOfWeek`'s 0=Sunday convention), in `timeZone`. */
export function startOfWeekInTimeZone(date: Date, timeZone: string): Date {
  const { year, month, day, dayOfWeek } = wallClockDateParts(date, timeZone);
  const sundayUtcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0) - dayOfWeek * 24 * 60 * 60 * 1000);
  return startOfDayInTimeZone(sundayUtcNoon, timeZone);
}

/** Midnight at the start of `date`'s calendar month, in `timeZone`. */
export function startOfMonthInTimeZone(date: Date, timeZone: string): Date {
  const { year, month } = wallClockDateParts(date, timeZone);
  return zonedWallClockToUtc(year, month, 1, timeZone);
}

/**
 * Distance travelled between the last known odometer reading at/before
 * `windowStart` and the last known reading at/before `windowEnd`. Returns
 * `null` if no reading exists at/before `windowStart` — there is no
 * baseline to measure from, so the distance is genuinely unknown, not zero.
 * Never returns a negative number (a odometer rollback/vehicle swap is
 * clamped to 0 rather than reported as negative travel).
 */
function distanceBetween(readings: OdometerReading[], windowStart: Date, windowEnd: Date): number | null {
  const withOdometer = readings.filter(
    (r): r is OdometerReading & { odometerKm: number } => r.odometerKm != null,
  );
  let baseline: number | null = null;
  let latest: number | null = null;
  for (const r of withOdometer) {
    if (r.recordedAt <= windowStart) baseline = r.odometerKm;
    if (r.recordedAt <= windowEnd) latest = r.odometerKm;
  }
  if (baseline == null || latest == null) return null;
  return Math.max(0, latest - baseline);
}

/**
 * The start of the vehicle's current ignition-on trip: walks backwards from
 * `at` through readings ordered oldest-first, finds the most recent
 * ignition-off -> on transition, and returns the timestamp of the reading
 * immediately after it. If no off->on transition is present in the given
 * readings (ignition has been on the whole time, or ignition state was
 * never reported), returns the earliest reading's timestamp — the longest
 * trip boundary the available data can support, not a fabricated guess
 * beyond it.
 */
function currentTripStart(readings: OdometerReading[], at: Date): Date | null {
  const upToNow = readings.filter((r) => r.recordedAt <= at).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (upToNow.length === 0) return null;
  if (upToNow.every((r) => r.ignitionOn == null)) return null; // no ignition signal at all — trip boundary undeterminable

  let tripStart = upToNow[0].recordedAt;
  for (let i = 1; i < upToNow.length; i++) {
    const prev = upToNow[i - 1];
    const curr = upToNow[i];
    if (prev.ignitionOn === false && curr.ignitionOn !== false) {
      tripStart = curr.recordedAt;
    }
  }
  return tripStart;
}

export interface ComputeDistanceSoFarInput {
  readings: OdometerReading[];
  at: Date;
  timezone: string;
}

/** Computes trip/day/week/month distance-so-far for `evaluatePolicyCompliance()`'s km-limit checks. Pure — takes readings already fetched by the caller, no DB access here. */
export function computeDistanceSoFar(input: ComputeDistanceSoFarInput): DistanceSoFar {
  const { readings, at, timezone } = input;

  const tripStart = currentTripStart(readings, at);
  const dayStart = startOfDayInTimeZone(at, timezone);
  const weekStart = startOfWeekInTimeZone(at, timezone);
  const monthStart = startOfMonthInTimeZone(at, timezone);

  return {
    trip: tripStart ? distanceBetween(readings, tripStart, at) : null,
    day: distanceBetween(readings, dayStart, at),
    week: distanceBetween(readings, weekStart, at),
    month: distanceBetween(readings, monthStart, at),
  };
}
