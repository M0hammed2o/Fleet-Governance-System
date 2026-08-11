import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { MockTelematicsProvider } from "@/lib/telematics/mock-provider";
import { TelematicsProviderUnavailableError } from "@/lib/telematics/provider";
import { haversineDistanceMeters, isWithinGeofence, evaluatePolicyCompliance } from "@/lib/telematics/geofence-engine";
import {
  syncVehicleTelematics,
  evaluateVehiclePolicyCompliance,
  requestManualGpsConfirmation,
  resolveManualGpsConfirmation,
  createGeofence,
  listGeofencesInTenant,
  createVehicleUsePolicy,
  approveVehicleUsePolicy,
  listVehicleUsePoliciesInTenant,
  getVehicleUsePolicyInTenant,
  VehicleNotFoundError,
  DriverNotFoundError,
  GeofenceNotFoundError,
  SelfApprovalNotAllowedError,
  NotTheApprovingManagerError,
  PolicyNotDraftError,
} from "@/lib/repositories/telematics-repository";
import { createTenant, createRole, createUser, createDriver, createVehicle } from "./helpers/fixtures";

async function baseSetup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const supervisor = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const driver = await createDriver(tenant.id);
  const vehicle = await createVehicle(tenant.id);
  return { tenant, user, supervisor, driver, vehicle };
}

describe("MockTelematicsProvider", () => {
  const provider = new MockTelematicsProvider();

  it("returns ok on testConnection", async () => {
    expect((await provider.testConnection()).ok).toBe(true);
  });

  it("returns a normal live snapshot by default", async () => {
    const snapshot = await provider.getSnapshot("vehicle-1");
    expect(snapshot.position).not.toBeNull();
    expect(snapshot.ignitionOn).toBe(true);
    expect(snapshot.lastCommunicationAt).not.toBeNull();
  });

  it("returns a stale/offline snapshot when forced", async () => {
    const snapshot = await provider.getSnapshot("vehicle-1:force:offline");
    expect(snapshot.position).toBeNull();
    expect(snapshot.lastCommunicationAt!.getTime()).toBeLessThan(Date.now() - 60 * 60 * 1000);
  });

  it("throws TelematicsProviderUnavailableError when forced", async () => {
    await expect(provider.getSnapshot("vehicle-1:force:unavailable")).rejects.toBeInstanceOf(TelematicsProviderUnavailableError);
  });

  it("returns the exact forced position for geofence testing", async () => {
    const snapshot = await provider.getSnapshot("vehicle-1:force:at:-33.9249,18.4241");
    expect(snapshot.position?.latitude).toBe(-33.9249);
    expect(snapshot.position?.longitude).toBe(18.4241);
  });

  it("returns ignitionOn false when forced", async () => {
    const snapshot = await provider.getSnapshot("vehicle-1:force:ignition-off");
    expect(snapshot.ignitionOn).toBe(false);
  });
});

describe("geofence-engine (pure)", () => {
  it("computes zero distance for the same point", () => {
    expect(haversineDistanceMeters({ latitude: -26.2041, longitude: 28.0473 }, { latitude: -26.2041, longitude: 28.0473 })).toBe(0);
  });

  it("computes a plausible non-zero distance between two known points", () => {
    // Johannesburg to Cape Town — roughly 1270km great-circle.
    const distance = haversineDistanceMeters({ latitude: -26.2041, longitude: 28.0473 }, { latitude: -33.9249, longitude: 18.4241 });
    expect(distance).toBeGreaterThan(1_200_000);
    expect(distance).toBeLessThan(1_350_000);
  });

  it("isWithinGeofence is true inside the radius, false outside", () => {
    const geofence = { centerLatitude: -26.2041, centerLongitude: 28.0473, radiusMeters: 500 };
    expect(isWithinGeofence({ latitude: -26.2041, longitude: 28.0473 }, geofence)).toBe(true);
    expect(isWithinGeofence({ latitude: -33.9249, longitude: 18.4241 }, geofence)).toBe(false);
  });

  const SAST = "Africa/Johannesburg"; // UTC+2, no DST — the seeded/default Tenant.timezone
  const noDistance = { trip: null, day: null, week: null, month: null };
  const basePolicy = {
    permittedDaysOfWeek: [] as number[],
    permittedStartTime: null as string | null,
    permittedEndTime: null as string | null,
    allowAfterHours: false,
    allowWeekend: false,
    approvedGeofence: null as { centerLatitude: number; centerLongitude: number; radiusMeters: number } | null,
    kmLimitPerTrip: null as number | null,
    kmLimitPerDay: null as number | null,
    kmLimitPerWeek: null as number | null,
    kmLimitPerMonth: null as number | null,
  };

  it("produces no violations for a fully compliant reading", () => {
    const mondayMorningSAST = new Date("2026-07-27T08:00:00Z"); // 10:00 SAST, a Monday
    const violations = evaluatePolicyCompliance({
      position: { latitude: -26.2041, longitude: 28.0473 },
      at: mondayMorningSAST,
      timezone: SAST,
      policy: {
        ...basePolicy,
        permittedStartTime: "08:00",
        permittedEndTime: "17:00",
        approvedGeofence: { centerLatitude: -26.2041, centerLongitude: 28.0473, radiusMeters: 500 },
        kmLimitPerTrip: 200,
      },
      distanceSoFar: { ...noDistance, trip: 50 },
    });
    expect(violations).toHaveLength(0);
  });

  it("flags OUTSIDE_APPROVED_GEOFENCE as HIGH severity", () => {
    const mondayMorningSAST = new Date("2026-07-27T08:00:00Z");
    const violations = evaluatePolicyCompliance({
      position: { latitude: -33.9249, longitude: 18.4241 },
      at: mondayMorningSAST,
      timezone: SAST,
      policy: { ...basePolicy, approvedGeofence: { centerLatitude: -26.2041, centerLongitude: 28.0473, radiusMeters: 500 } },
      distanceSoFar: noDistance,
    });
    expect(violations.find((v) => v.type === "OUTSIDE_APPROVED_GEOFENCE")?.severity).toBe("HIGH");
  });

  it("flags WEEKEND_USE_NOT_PERMITTED on a Saturday when allowWeekend is false", () => {
    const saturdayMorningSAST = new Date("2026-07-25T08:00:00Z"); // 10:00 SAST, a Saturday
    const violations = evaluatePolicyCompliance({
      position: null,
      at: saturdayMorningSAST,
      timezone: SAST,
      policy: basePolicy,
      distanceSoFar: noDistance,
    });
    expect(violations.some((v) => v.type === "WEEKEND_USE_NOT_PERMITTED")).toBe(true);
  });

  it("does not flag weekend use when allowWeekend is true", () => {
    const saturdayMorningSAST = new Date("2026-07-25T08:00:00Z");
    const violations = evaluatePolicyCompliance({
      position: null,
      at: saturdayMorningSAST,
      timezone: SAST,
      policy: { ...basePolicy, allowWeekend: true },
      distanceSoFar: noDistance,
    });
    expect(violations.some((v) => v.type === "WEEKEND_USE_NOT_PERMITTED")).toBe(false);
  });

  it("flags OUTSIDE_PERMITTED_HOURS outside the configured window", () => {
    const lateNightSAST = new Date("2026-07-27T21:00:00Z"); // 23:00 SAST, Monday
    const violations = evaluatePolicyCompliance({
      position: null,
      at: lateNightSAST,
      timezone: SAST,
      policy: { ...basePolicy, permittedStartTime: "08:00", permittedEndTime: "17:00" },
      distanceSoFar: noDistance,
    });
    expect(violations.some((v) => v.type === "OUTSIDE_PERMITTED_HOURS")).toBe(true);
  });

  it("does not flag hours when allowAfterHours is true", () => {
    const lateNightSAST = new Date("2026-07-27T21:00:00Z");
    const violations = evaluatePolicyCompliance({
      position: null,
      at: lateNightSAST,
      timezone: SAST,
      policy: { ...basePolicy, permittedStartTime: "08:00", permittedEndTime: "17:00", allowAfterHours: true },
      distanceSoFar: noDistance,
    });
    expect(violations.some((v) => v.type === "OUTSIDE_PERMITTED_HOURS")).toBe(false);
  });

  it("flags TRIP_DISTANCE_LIMIT_EXCEEDED when trip distance exceeds the per-trip limit", () => {
    const mondayMorningSAST = new Date("2026-07-27T08:00:00Z");
    const violations = evaluatePolicyCompliance({
      position: null,
      at: mondayMorningSAST,
      timezone: SAST,
      policy: { ...basePolicy, kmLimitPerTrip: 100 },
      distanceSoFar: { ...noDistance, trip: 150 },
    });
    expect(violations.some((v) => v.type === "TRIP_DISTANCE_LIMIT_EXCEEDED")).toBe(true);
  });

  it("flags DAILY/WEEKLY/MONTHLY_DISTANCE_LIMIT_EXCEEDED independently of the per-trip limit", () => {
    const mondayMorningSAST = new Date("2026-07-27T08:00:00Z");
    const violations = evaluatePolicyCompliance({
      position: null,
      at: mondayMorningSAST,
      timezone: SAST,
      policy: { ...basePolicy, kmLimitPerDay: 100, kmLimitPerWeek: 300, kmLimitPerMonth: 1000 },
      distanceSoFar: { trip: null, day: 150, week: 350, month: 1200 },
    });
    expect(violations.some((v) => v.type === "DAILY_DISTANCE_LIMIT_EXCEEDED")).toBe(true);
    expect(violations.some((v) => v.type === "WEEKLY_DISTANCE_LIMIT_EXCEEDED")).toBe(true);
    expect(violations.some((v) => v.type === "MONTHLY_DISTANCE_LIMIT_EXCEEDED")).toBe(true);
  });

  it("never flags a distance limit when the computed distance is null (insufficient data), rather than treating it as zero", () => {
    const mondayMorningSAST = new Date("2026-07-27T08:00:00Z");
    const violations = evaluatePolicyCompliance({
      position: null,
      at: mondayMorningSAST,
      timezone: SAST,
      policy: { ...basePolicy, kmLimitPerTrip: 1, kmLimitPerDay: 1, kmLimitPerWeek: 1, kmLimitPerMonth: 1 },
      distanceSoFar: noDistance,
    });
    expect(violations).toHaveLength(0);
  });

  describe("timezone boundary — must use the tenant's IANA timezone, not the server/UTC clock", () => {
    it("evaluates permitted-day against the tenant's local calendar day, which can differ from the UTC calendar day", () => {
      // 2026-07-27T23:30:00Z is Monday in UTC, but 2026-07-28T01:30 SAST — already Tuesday locally.
      const crossesMidnightInSAST = new Date("2026-07-27T23:30:00Z");
      const violations = evaluatePolicyCompliance({
        position: null,
        at: crossesMidnightInSAST,
        timezone: SAST,
        policy: { ...basePolicy, permittedDaysOfWeek: [2] /* Tuesday only */, allowWeekend: true },
        distanceSoFar: noDistance,
      });
      // Locally (SAST) this is Tuesday, a permitted day — a UTC-based evaluation would
      // see Monday (not in permittedDaysOfWeek) and wrongly flag OUTSIDE_PERMITTED_DAY.
      expect(violations.some((v) => v.type === "OUTSIDE_PERMITTED_DAY")).toBe(false);
    });

    it("evaluates permitted-hours against the tenant's local clock, which can differ from the UTC hour", () => {
      // 21:30 UTC = 23:30 SAST — outside a 08:00-22:00 local window, even though 21:30 UTC would be inside it.
      const at = new Date("2026-07-27T21:30:00Z");
      const violations = evaluatePolicyCompliance({
        position: null,
        at,
        timezone: SAST,
        policy: { ...basePolicy, permittedStartTime: "08:00", permittedEndTime: "22:00" },
        distanceSoFar: noDistance,
      });
      expect(violations.some((v) => v.type === "OUTSIDE_PERMITTED_HOURS")).toBe(true);
    });

    it("a different tenant timezone shifts the same instant to a compliant local time", () => {
      // The same UTC instant as above, evaluated against a UTC-based tenant timezone
      // instead, lands at 21:30 local — inside the 08:00-22:00 window.
      const at = new Date("2026-07-27T21:30:00Z");
      const violations = evaluatePolicyCompliance({
        position: null,
        at,
        timezone: "UTC",
        policy: { ...basePolicy, permittedStartTime: "08:00", permittedEndTime: "22:00" },
        distanceSoFar: noDistance,
      });
      expect(violations.some((v) => v.type === "OUTSIDE_PERMITTED_HOURS")).toBe(false);
    });
  });
});

describe("syncVehicleTelematics (GPS-001/003/006)", () => {
  it("rejects syncing a vehicle that doesn't exist in this tenant", async () => {
    const { tenant, user } = await baseSetup();
    await expect(
      syncVehicleTelematics({ tenantId: tenant.id, vehicleId: "nonexistent", actorUserId: user.id }),
    ).rejects.toBeInstanceOf(VehicleNotFoundError);
  });

  it("records a normal live reading and marks the vehicle ACTIVE", async () => {
    const { tenant, user, vehicle } = await baseSetup();
    const result = await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });
    expect(result.vehicle.gpsStatus).toBe("ACTIVE");
    expect(result.isStale).toBe(false);
    expect(result.event).not.toBeNull();
  });

  it("marks the vehicle INACTIVE and flags stale when the provider reports offline (defense-in-depth against trusting stale data)", async () => {
    const { tenant, user } = await baseSetup();
    const vehicle = await createVehicle(tenant.id);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { gpsDeviceReference: `${vehicle.id}:force:offline` } });

    const result = await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });
    expect(result.vehicle.gpsStatus).toBe("INACTIVE");
    expect(result.isStale).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("surfaces a provider failure as a typed error, not a raw 500, and marks the vehicle INACTIVE", async () => {
    const { tenant, user } = await baseSetup();
    const vehicle = await createVehicle(tenant.id);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { gpsDeviceReference: `${vehicle.id}:force:unavailable` } });

    await expect(
      syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id }),
    ).rejects.toBeInstanceOf(TelematicsProviderUnavailableError);

    const reloaded = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(reloaded.gpsStatus).toBe("INACTIVE");
  });

  it("raises a HIGH exception when the vehicle is outside its active policy's approved geofence (GPS-004/GPS-005/POLICY-002)", async () => {
    const { tenant, user } = await baseSetup();
    const driver = await createDriver(tenant.id);
    const vehicle = await createVehicle(tenant.id);
    // Approved geofence far from the mock provider's default position.
    const geofence = await createGeofence({ tenantId: tenant.id, name: "Approved Site", centerLatitude: -33.9249, centerLongitude: 18.4241, radiusMeters: 500 });
    const policy = await createVehicleUsePolicy({
      tenantId: tenant.id,
      name: "Sales team policy",
      driverId: driver.id,
      vehicleIds: [vehicle.id],
      effectiveFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
      approvedGeofenceId: geofence.id,
    });
    await approveVehicleUsePolicy(tenant.id, policy.id, user.id);

    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { gpsDeviceReference: vehicle.id } }); // default JHB position, outside Cape Town geofence

    const result = await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });
    expect(result.violations.some((v) => v.type === "OUTSIDE_APPROVED_GEOFENCE")).toBe(true);

    const exception = await prisma.exception.findFirst({ where: { tenantId: tenant.id, vehicleId: vehicle.id } });
    expect(exception).not.toBeNull();
    expect(exception?.severity).toBe("HIGH");
    expect(exception?.gateEventId).toBeNull();
    expect(exception?.requiresSupervisorApproval).toBe(true);
  });

  it("does not evaluate policy compliance for a vehicle with no assigned active policy", async () => {
    const { tenant, user, vehicle } = await baseSetup();
    const result = await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });
    expect(result.violations).toHaveLength(0);
  });
});

describe("GPS-exception deduplication (Phase 8A) — episode tracking, escalation, and auto-clearing", () => {
  async function setUpOutsideGeofencePolicy() {
    const { tenant, user, vehicle } = await baseSetup();
    const driver = await createDriver(tenant.id);
    const geofence = await createGeofence({ tenantId: tenant.id, name: "Approved Site", centerLatitude: -33.9249, centerLongitude: 18.4241, radiusMeters: 500 });
    const policy = await createVehicleUsePolicy({
      tenantId: tenant.id,
      name: "Sales team policy",
      driverId: driver.id,
      vehicleIds: [vehicle.id],
      effectiveFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
      approvedGeofenceId: geofence.id,
    });
    await approveVehicleUsePolicy(tenant.id, policy.id, user.id);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { gpsDeviceReference: vehicle.id } }); // default JHB position, outside Cape Town geofence
    return { tenant, user, vehicle, policy };
  }

  it("does not raise a second open exception when the same violation persists across repeated syncs", async () => {
    const { tenant, user, vehicle } = await setUpOutsideGeofencePolicy();

    await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });
    await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });
    await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });

    const exceptions = await prisma.exception.findMany({ where: { tenantId: tenant.id, vehicleId: vehicle.id, violationType: "OUTSIDE_APPROVED_GEOFENCE" } });
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].observationCount).toBe(3);
    expect(exceptions[0].resolvedAt).toBeNull();
  });

  it("escalates a continuing violation to HIGH/supervisor-approval once it persists past the observation threshold", async () => {
    const { tenant, user, vehicle } = await baseSetup();
    const driver = await createDriver(tenant.id);
    // A MEDIUM violation (weekend use) so escalation is observable — geofence violations already start HIGH.
    const policy = await createVehicleUsePolicy({
      tenantId: tenant.id,
      name: "Weekday only policy",
      driverId: driver.id,
      vehicleIds: [vehicle.id],
      // Keep the policy active for the fixed 2026-08-01 Saturday event
      // below; a relative "now - 1 day" start made this test fail once the
      // real clock advanced beyond that event date.
      effectiveFrom: new Date("2026-07-01T00:00:00Z"),
      allowWeekend: false,
    });
    await approveVehicleUsePolicy(tenant.id, policy.id, user.id);

    // Called directly (not through syncVehicleTelematics/the mock provider's
    // real "now") with a fixed, deterministic Saturday, so this test never
    // depends on which real-world day the suite happens to run on.
    const saturday = new Date("2026-08-01T08:00:00Z");
    const event = { latitude: -26.2041, longitude: 28.0473, recordedAt: saturday };

    await evaluateVehiclePolicyCompliance(tenant.id, vehicle.id, event, user.id);
    await evaluateVehiclePolicyCompliance(tenant.id, vehicle.id, event, user.id);
    await evaluateVehiclePolicyCompliance(tenant.id, vehicle.id, event, user.id);

    const exception = await prisma.exception.findFirst({ where: { tenantId: tenant.id, vehicleId: vehicle.id, violationType: "WEEKEND_USE_NOT_PERMITTED" } });
    expect(exception?.observationCount).toBe(3);
    expect(exception?.severity).toBe("HIGH");
    expect(exception?.requiresSupervisorApproval).toBe(true);

    const escalationAudit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "telematics.policyViolationEscalated", entityId: exception!.id } });
    expect(escalationAudit).not.toBeNull();
  });

  it("automatically clears an open episode once the vehicle returns to compliance on a later sync", async () => {
    const { tenant, user, vehicle, policy } = await setUpOutsideGeofencePolicy();

    await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });
    const openException = await prisma.exception.findFirst({ where: { tenantId: tenant.id, vehicleId: vehicle.id, violationType: "OUTSIDE_APPROVED_GEOFENCE" } });
    expect(openException?.resolvedAt).toBeNull();

    // Vehicle becomes compliant: suspend the policy so there's nothing left to violate.
    await prisma.vehicleUsePolicy.update({ where: { id: policy.id }, data: { status: "SUSPENDED" } });
    await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });

    const cleared = await prisma.exception.findUniqueOrThrow({ where: { id: openException!.id } });
    expect(cleared.resolvedAt).not.toBeNull();
    expect(cleared.resolutionNotes).toMatch(/automatically cleared/i);

    const clearAudit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "telematics.policyViolationCleared", entityId: openException!.id } });
    expect(clearAudit).not.toBeNull();

    // No duplicate/new exception should be created once cleared and the vehicle stays compliant.
    const stillOpen = await prisma.exception.findMany({ where: { tenantId: tenant.id, vehicleId: vehicle.id, resolvedAt: null } });
    expect(stillOpen).toHaveLength(0);
  });

  it("does not touch a gate-event exception (violationType null) when reconciling telematics violations", async () => {
    const { tenant, user, vehicle } = await setUpOutsideGeofencePolicy();
    const unrelated = await prisma.exception.create({
      data: { tenantId: tenant.id, vehicleId: vehicle.id, description: "Manually raised, not telematics-tracked", severity: "MEDIUM", raisedByUserId: user.id },
    });

    await syncVehicleTelematics({ tenantId: tenant.id, vehicleId: vehicle.id, actorUserId: user.id });

    const reloaded = await prisma.exception.findUniqueOrThrow({ where: { id: unrelated.id } });
    expect(reloaded.resolvedAt).toBeNull();
    expect(reloaded.violationType).toBeNull();
  });
});

describe("manual GPS confirmation (GPS-002) — mirrors facial-verification manual fallback", () => {
  it("records a request with reason, requester, position description, and an audit event", async () => {
    const { tenant, user, vehicle } = await baseSetup();
    const confirmation = await requestManualGpsConfirmation({
      tenantId: tenant.id,
      vehicleId: vehicle.id,
      requestedByUserId: user.id,
      reason: "GPS provider offline for 2 hours",
      positionDescription: "Driver confirmed by phone: at Johannesburg Distribution Centre, Main Gate",
    });
    expect(confirmation.status).toBe("PENDING");

    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "telematics.manualGpsConfirmation.requested", entityId: confirmation.id } });
    expect(auditRow).not.toBeNull();
  });

  it("rejects the requester resolving their own request", async () => {
    const { tenant, user, vehicle } = await baseSetup();
    const confirmation = await requestManualGpsConfirmation({
      tenantId: tenant.id, vehicleId: vehicle.id, requestedByUserId: user.id, reason: "test", positionDescription: "test",
    });
    await expect(
      resolveManualGpsConfirmation({ tenantId: tenant.id, confirmationId: confirmation.id, approvedByUserId: user.id, decision: "APPROVED" }),
    ).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });

  it("allows a different user to approve, recording resolver and audit event", async () => {
    const { tenant, user, supervisor, vehicle } = await baseSetup();
    const confirmation = await requestManualGpsConfirmation({
      tenantId: tenant.id, vehicleId: vehicle.id, requestedByUserId: user.id, reason: "test", positionDescription: "test",
    });
    const resolved = await resolveManualGpsConfirmation({ tenantId: tenant.id, confirmationId: confirmation.id, approvedByUserId: supervisor.id, decision: "APPROVED" });
    expect(resolved?.status).toBe("APPROVED");
    expect(resolved?.approvedByUserId).toBe(supervisor.id);
  });

  it("allows a different user to deny", async () => {
    const { tenant, user, supervisor, vehicle } = await baseSetup();
    const confirmation = await requestManualGpsConfirmation({
      tenantId: tenant.id, vehicleId: vehicle.id, requestedByUserId: user.id, reason: "test", positionDescription: "test",
    });
    const resolved = await resolveManualGpsConfirmation({ tenantId: tenant.id, confirmationId: confirmation.id, approvedByUserId: supervisor.id, decision: "DENIED" });
    expect(resolved?.status).toBe("DENIED");
  });

  it("rejects requesting a confirmation for a vehicle that doesn't exist in this tenant", async () => {
    const { tenant, user } = await baseSetup();
    await expect(
      requestManualGpsConfirmation({ tenantId: tenant.id, vehicleId: "nonexistent", requestedByUserId: user.id, reason: "test", positionDescription: "test" }),
    ).rejects.toBeInstanceOf(VehicleNotFoundError);
  });
});

describe("Geofence catalogue", () => {
  it("creates and lists geofences scoped to the tenant", async () => {
    const { tenant } = await baseSetup();
    await createGeofence({ tenantId: tenant.id, name: "Head Office", centerLatitude: -26.2041, centerLongitude: 28.0473, radiusMeters: 300 });
    const geofences = await listGeofencesInTenant(tenant.id);
    expect(geofences).toHaveLength(1);
  });

  it("does not leak geofences across tenants", async () => {
    const { tenant } = await baseSetup();
    const other = await createTenant("Other Tenant");
    await createGeofence({ tenantId: tenant.id, name: "Tenant A Site", centerLatitude: -26.2041, centerLongitude: 28.0473, radiusMeters: 300 });
    expect(await listGeofencesInTenant(other.id)).toHaveLength(0);
  });
});

describe("VehicleUsePolicy (POLICY-001)", () => {
  it("creates a policy covering one or more vehicles, defaulting to DRAFT", async () => {
    const { tenant, user, driver, vehicle } = await baseSetup();
    const secondVehicle = await createVehicle(tenant.id);
    const policy = await createVehicleUsePolicy({
      tenantId: tenant.id,
      name: "Pool vehicles policy",
      driverId: driver.id,
      vehicleIds: [vehicle.id, secondVehicle.id],
      effectiveFrom: new Date(),
      approvingManagerUserId: user.id,
      kmLimitPerTrip: 150,
      allowWeekend: false,
    });
    expect(policy.status).toBe("DRAFT");
    expect(policy.vehicles).toHaveLength(2);
  });

  it("rejects an unknown driverId", async () => {
    const { tenant, vehicle } = await baseSetup();
    await expect(
      createVehicleUsePolicy({ tenantId: tenant.id, name: "x", driverId: "nonexistent", vehicleIds: [vehicle.id], effectiveFrom: new Date() }),
    ).rejects.toBeInstanceOf(DriverNotFoundError);
  });

  it("rejects an unknown vehicleId", async () => {
    const { tenant, driver } = await baseSetup();
    await expect(
      createVehicleUsePolicy({ tenantId: tenant.id, name: "x", driverId: driver.id, vehicleIds: ["nonexistent"], effectiveFrom: new Date() }),
    ).rejects.toBeInstanceOf(VehicleNotFoundError);
  });

  it("rejects an unknown approvedGeofenceId", async () => {
    const { tenant, driver, vehicle } = await baseSetup();
    await expect(
      createVehicleUsePolicy({ tenantId: tenant.id, name: "x", driverId: driver.id, vehicleIds: [vehicle.id], effectiveFrom: new Date(), approvedGeofenceId: "nonexistent" }),
    ).rejects.toBeInstanceOf(GeofenceNotFoundError);
  });

  it("only the named approving manager can approve, moving DRAFT to ACTIVE", async () => {
    const { tenant, user, supervisor, driver, vehicle } = await baseSetup();
    const policy = await createVehicleUsePolicy({
      tenantId: tenant.id, name: "x", driverId: driver.id, vehicleIds: [vehicle.id], effectiveFrom: new Date(), approvingManagerUserId: supervisor.id,
    });

    await expect(approveVehicleUsePolicy(tenant.id, policy.id, user.id)).rejects.toBeInstanceOf(NotTheApprovingManagerError);

    const approved = await approveVehicleUsePolicy(tenant.id, policy.id, supervisor.id);
    expect(approved?.status).toBe("ACTIVE");
  });

  it("rejects approving an already-ACTIVE policy", async () => {
    const { tenant, supervisor, driver, vehicle } = await baseSetup();
    const policy = await createVehicleUsePolicy({
      tenantId: tenant.id, name: "x", driverId: driver.id, vehicleIds: [vehicle.id], effectiveFrom: new Date(), approvingManagerUserId: supervisor.id,
    });
    await approveVehicleUsePolicy(tenant.id, policy.id, supervisor.id);
    await expect(approveVehicleUsePolicy(tenant.id, policy.id, supervisor.id)).rejects.toBeInstanceOf(PolicyNotDraftError);
  });

  it("records an audit event on creation and on approval", async () => {
    const { tenant, supervisor, driver, vehicle } = await baseSetup();
    const policy = await createVehicleUsePolicy({
      tenantId: tenant.id, name: "x", driverId: driver.id, vehicleIds: [vehicle.id], effectiveFrom: new Date(), approvingManagerUserId: supervisor.id,
    });
    await approveVehicleUsePolicy(tenant.id, policy.id, supervisor.id);

    expect(await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "vehicleUsePolicy.created", entityId: policy.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "vehicleUsePolicy.approved", entityId: policy.id } })).not.toBeNull();
  });

  it("lists and fetches policies scoped to the tenant, invisible cross-tenant", async () => {
    const { tenant, driver, vehicle } = await baseSetup();
    const other = await createTenant("Other Tenant");
    const policy = await createVehicleUsePolicy({ tenantId: tenant.id, name: "x", driverId: driver.id, vehicleIds: [vehicle.id], effectiveFrom: new Date() });

    expect(await listVehicleUsePoliciesInTenant(tenant.id)).toHaveLength(1);
    expect(await listVehicleUsePoliciesInTenant(other.id)).toHaveLength(0);
    expect(await getVehicleUsePolicyInTenant(other.id, policy.id)).toBeNull();
    expect(await getVehicleUsePolicyInTenant(tenant.id, policy.id)).not.toBeNull();
  });
});
