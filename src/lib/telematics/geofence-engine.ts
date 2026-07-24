/**
 * Pure, DB-free geofence + vehicle-use-policy compliance engine — same
 * "pure module" pattern as lib/gate-events/state-machine.ts and
 * lib/reconciliation/discrepancy-engine.ts. Never concludes fraud, theft or
 * criminal conduct (POLICY-002/GPS-005) — only states which configured rule
 * a reading fell outside of, for a human to review.
 *
 * Time-of-day/day-of-week checks use the server's local clock on the `at`
 * Date passed in, not a per-tenant timezone conversion — acceptable for this
 * "basic geofence monitoring" phase (GPS-004 explicitly scopes out anything
 * beyond approved-destination/after-hours/mileage-allowance monitoring); a
 * real per-tenant timezone-aware evaluation is a documented future
 * improvement, not silently assumed correct.
 */

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
  | "DISTANCE_LIMIT_EXCEEDED";

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
}

export interface EvaluatePolicyComplianceInput {
  position: GeoPoint | null;
  at: Date;
  policy: PolicyLike;
  tripKmSoFar: number | null;
}

export function evaluatePolicyCompliance(input: EvaluatePolicyComplianceInput): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const { policy, at } = input;

  if (policy.approvedGeofence && input.position && !isWithinGeofence(input.position, policy.approvedGeofence)) {
    violations.push({
      type: "OUTSIDE_APPROVED_GEOFENCE",
      severity: "HIGH",
      description: "Vehicle position is outside the approved geofence for its assigned vehicle-use policy.",
    });
  }

  const dayOfWeek = at.getDay(); // 0 = Sunday, 6 = Saturday
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
    const currentMinutes = at.getHours() * 60 + at.getMinutes();
    if (startMinutes != null && endMinutes != null && (currentMinutes < startMinutes || currentMinutes > endMinutes)) {
      violations.push({
        type: "OUTSIDE_PERMITTED_HOURS",
        severity: "MEDIUM",
        description: `Vehicle movement recorded outside the permitted ${policy.permittedStartTime}-${policy.permittedEndTime} window.`,
      });
    }
  }

  if (policy.kmLimitPerTrip != null && input.tripKmSoFar != null && input.tripKmSoFar > policy.kmLimitPerTrip) {
    violations.push({
      type: "DISTANCE_LIMIT_EXCEEDED",
      severity: "MEDIUM",
      description: `Trip distance (${input.tripKmSoFar} km) exceeds this vehicle-use policy's per-trip limit (${policy.kmLimitPerTrip} km).`,
    });
  }

  return violations;
}
