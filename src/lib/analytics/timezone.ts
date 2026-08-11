/**
 * Date-only reporting periods are interpreted in the tenant's IANA time
 * zone, then converted to an inclusive-start/exclusive-end UTC range for DB
 * queries. This avoids the common UTC-midnight leak across tenant-local days.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export class InvalidAnalyticsPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnalyticsPeriodError";
  }
}

function datePartsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch {
    throw new InvalidAnalyticsPeriodError("The tenant time zone is invalid.");
  }
}

/** Convert a tenant-local wall-clock date/time into its UTC instant. */
export function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  assertValidTimeZone(timeZone);
  const targetAsUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour ?? 0, input.minute ?? 0, input.second ?? 0);
  let candidate = new Date(targetAsUtc);

  // Two passes handle ordinary offsets and daylight-saving transitions
  // without adding a heavyweight date dependency.
  for (let i = 0; i < 3; i += 1) {
    const actual = datePartsInZone(candidate, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const correction = targetAsUtc - actualAsUtc;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  return candidate;
}

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new InvalidAnalyticsPeriodError("Dates must use YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new InvalidAnalyticsPeriodError("The reporting date is invalid.");
  }
  return { year, month, day };
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = datePartsInZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function localHourMinute(date: Date, timeZone: string): string {
  const parts = datePartsInZone(date, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function defaultReportingDateRange(now: Date, timeZone: string, days = 30) {
  const endKey = localDateKey(now, timeZone);
  const endParts = parseDateOnly(endKey);
  const endExclusive = zonedDateTimeToUtc({ ...endParts, day: endParts.day + 1 }, timeZone);
  const startCalendar = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day - days + 1));
  const start = zonedDateTimeToUtc({ year: startCalendar.getUTCFullYear(), month: startCalendar.getUTCMonth() + 1, day: startCalendar.getUTCDate() }, timeZone);
  return { start, endExclusive, startDate: localDateKey(start, timeZone), endDate: endKey };
}

export function reportingRangeFromDateOnly(
  startDate: string | undefined,
  endDate: string | undefined,
  timeZone: string,
  now = new Date(),
  maximumDays = 366,
) {
  if (!startDate && !endDate) return defaultReportingDateRange(now, timeZone);
  if (!startDate || !endDate) throw new InvalidAnalyticsPeriodError("Both startDate and endDate are required.");
  const startParts = parseDateOnly(startDate);
  const endParts = parseDateOnly(endDate);
  const start = zonedDateTimeToUtc(startParts, timeZone);
  const endExclusive = zonedDateTimeToUtc({ ...endParts, day: endParts.day + 1 }, timeZone);
  const span = endExclusive.getTime() - start.getTime();
  if (span <= 0) throw new InvalidAnalyticsPeriodError("The end date must not be before the start date.");
  if (span > maximumDays * DAY_MS + 2 * 60 * 60 * 1000) {
    throw new InvalidAnalyticsPeriodError(`Reporting periods are limited to ${maximumDays} days.`);
  }
  return { start, endExclusive, startDate, endDate };
}

export function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * DAY_MS);
}

/** Subtract tenant-local calendar dates from a local-midnight boundary. */
export function subtractTenantCalendarDays(boundary: Date, days: number, timeZone: string): Date {
  const parts = datePartsInZone(boundary, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - days));
  return zonedDateTimeToUtc({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }, timeZone);
}
