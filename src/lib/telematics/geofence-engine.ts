/**
 * Pure, DB-free geofence + vehicle-use-policy compliance engine — same
 * "pure module" pattern as lib/gate-events/state-machine.ts and
 * lib/reconciliation/discrepancy-engine.ts. Never concludes fraud, theft or
 * criminal conduct (POLICY-002/GPS-005) — only states which configured rule
 * a reading fell outside of, for a human to review.
 *
 * Time-of-day/day-of-week/weekend checks are evaluated in the tenant's
 * configured IANA timezone (`Tenant.timezone`, Phase 8A), not the server's
 * local clock — a reading recorded at 22:00 UTC is "after hours" or not
 * depending on what time that actually is in Johannesburg (or wherever the
 * tenant operates), not what time it is on the machine running this process.
 */

const WEEKDAY_TO_NUMBER: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock day-of-week (0=Sunday..6=Saturday) and time-of-day for `date`, as observed in `timeZone`. */
export function getWallClockParts(date: Date, timeZone: string): { dayOfWeek: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const dayOfWeek = WEEKDAY_TO_NUMBER[byType.weekday ?? ""] ?? date.getUTCDay();
  return { dayOfWeek, hour: Number(byType.hour), minute: Number(byType.minute) };
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeofenceLike {
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
}

const EARTH_RADIUS_METERS = 6371000;

export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithinGeofence(position: GeoPoint, geofence: GeofenceLike): boolean {
  const distance = haversineDistanceMeters(position, {
    latitude: geofence.centerLatitude,
    longitude: geofence.centerLongitude,
  });
  return distance <= geofence.radiusMeters;
}

function parseTimeToMinutes(hhmm: string): number | null {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export type PolicyViolationType =
  | "OUTSIDE_APPROVED_GEOFENCE"
  | "OUTSIDE_PERMITTED_DAY"
  | "OUTSIDE_PERMITTED_HOURS"
  | "WEEKEND_USE_NOT_PERMITTED"
  | "TRIP_DISTANCE_LIMIT_EXCEEDED"
  | "DAILY_DISTANCE_LIMIT_EXCEEDED"
  | "WEEKLY_DISTANCE_LIMIT_EXCEEDED"
  | "MONTHLY_DISTANCE_LIMIT_EXCEEDED";

export interface PolicyViolation {
  type: PolicyViolationType;
  severity: "MEDIUM" | "HIGH";
  description: string;
}

export interface PolicyLike {
  permittedDaysOfWeek: number[];
  permittedStartTime: string | null;
  permittedEndTime: string | null;
  allowAfterHours: boolean;
  allowWeekend: boolean;
  approvedGeofence: GeofenceLike | null;
  kmLimitPerTrip: number | null;
  kmLimitPerDay: number | null;
  kmLimitPerWeek: number | null;
  kmLimitPerMonth: number | null;
}

/** Distances travelled so far in each window, as computed by lib/telematics/distance-engine.ts — null means "not enough data to know", never treated as zero. */
export interface DistanceSoFar {
  trip: number | null;
  day: number | null;
  week: number | null;
  month: number | null;
}

export interface EvaluatePolicyComplianceInput {
  position: GeoPoint | null;
  at: Date;
  /** IANA timezone name (typically the tenant's `Tenant.timezone`) — day-of-week/hour checks are evaluated in this timezone, not the server's local clock. */
  timezone: string;
  policy: PolicyLike;
  distanceSoFar: DistanceSoFar;
}

export function evaluatePolicyCompliance(input: EvaluatePolicyComplianceInput): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const { policy, at, timezone, distanceSoFar } = input;

  if (policy.approvedGeofence && input.position && !isWithinGeofence(input.position, policy.approvedGeofence)) {
    violations.push({
      type: "OUTSIDE_APPROVED_GEOFENCE",
      severity: "HIGH",
      description: "Vehicle position is outside the approved geofence for its assigned vehicle-use policy.",
    });
  }

  const { dayOfWeek, hour, minute } = getWallClockParts(at, timezone);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (isWeekend && !policy.allowWeekend) {
    violations.push({
      type: "WEEKEND_USE_NOT_PERMITTED",
      severity: "MEDIUM",
      description: "Vehicle movement recorded on a weekend, which this vehicle-use policy does not permit.",
    });
  } else if (!isWeekend && policy.permittedDaysOfWeek.length > 0 && !policy.permittedDaysOfWeek.includes(dayOfWeek)) {
    violations.push({
      type: "OUTSIDE_PERMITTED_DAY",
      severity: "MEDIUM",
      description: "Vehicle movement recorded on a day not in this vehicle-use policy's permitted days.",
    });
  }

  if (policy.permittedStartTime && policy.permittedEndTime && !policy.allowAfterHours) {
    const startMinutes = parseTimeToMinutes(policy.permittedStartTime);
    const endMinutes = parseTimeToMinutes(policy.permittedEndTime);
    const currentMinutes = hour * 60 + minute;
    if (startMinutes != null && endMinutes != null && (currentMinutes < startMinutes || currentMinutes > endMinutes)) {
      violations.push({
        type: "OUTSIDE_PERMITTED_HOURS",
        severity: "MEDIUM",
        description: `Vehicle movement recorded outside the permitted ${policy.permittedStartTime}-${policy.permittedEndTime} window.`,
      });
    }
  }

  if (policy.kmLimitPerTrip != null && distanceSoFar.trip != null && distanceSoFar.trip > policy.kmLimitPerTrip) {
    violations.push({
      type: "TRIP_DISTANCE_LIMIT_EXCEEDED",
      severity: "MEDIUM",
      description: `Trip distance (${distanceSoFar.trip} km) exceeds this vehicle-use policy's per-trip limit (${policy.kmLimitPerTrip} km).`,
    });
  }

  if (policy.kmLimitPerDay != null && distanceSoFar.day != null && distanceSoFar.day > policy.kmLimitPerDay) {
    violations.push({
      type: "DAILY_DISTANCE_LIMIT_EXCEEDED",
      severity: "MEDIUM",
      description: `Distance travelled today (${distanceSoFar.day} km) exceeds this vehicle-use policy's daily limit (${policy.kmLimitPerDay} km).`,
    });
  }

  if (policy.kmLimitPerWeek != null && distanceSoFar.week != null && distanceSoFar.week > policy.kmLimitPerWeek) {
    violations.push({
      type: "WEEKLY_DISTANCE_LIMIT_EXCEEDED",
      severity: "MEDIUM",
      description: `Distance travelled this week (${distanceSoFar.week} km) exceeds this vehicle-use policy's weekly limit (${policy.kmLimitPerWeek} km).`,
    });
  }

  if (policy.kmLimitPerMonth != null && distanceSoFar.month != null && distanceSoFar.month > policy.kmLimitPerMonth) {
    violations.push({
      type: "MONTHLY_DISTANCE_LIMIT_EXCEEDED",
      severity: "MEDIUM",
      description: `Distance travelled this month (${distanceSoFar.month} km) exceeds this vehicle-use policy's monthly limit (${policy.kmLimitPerMonth} km).`,
    });
  }

  return violations;
}
