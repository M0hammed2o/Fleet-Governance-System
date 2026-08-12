import { afterEach, describe, expect, it, vi } from "vitest";
import { callTrackerWithPolicy, type TrackerConnectionContext } from "@/lib/telematics/integration-contract";
import { runTrackerConformanceSuite } from "@/lib/telematics/conformance-suite";
import { distanceToKm, normalizeTrackerObservation, speedToKmh } from "@/lib/telematics/normalization";
import { SYNTHETIC_TRACKER_SCENARIOS, SyntheticTrackerProductionRefusalError, SyntheticTrackerSimulator } from "@/lib/telematics/synthetic-simulator";

const originalAppEnvironment = process.env.APP_ENV;
const originalNodeEnvironment = process.env.NODE_ENV;
const now = new Date("2030-01-15T10:00:00.000Z");
const connection: TrackerConnectionContext = {
  tenantId: "tenant-synthetic",
  connectionId: "connection-synthetic",
  providerId: "synthetic",
  customerAuthorizationReference: "SYNTHETIC-AUTHORIZATION-NOT-REAL",
  credentialVersion: 1,
};
const request = () => ({ correlationId: "safe-correlation", signal: new AbortController().signal });

afterEach(() => {
  if (originalAppEnvironment === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalAppEnvironment;
  if (originalNodeEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", originalNodeEnvironment);
});

describe("provider-neutral synthetic tracker simulator", () => {
  it("refuses explicit and ambient production activation", () => {
    expect(() => new SyntheticTrackerSimulator({ environment: "production" })).toThrow(SyntheticTrackerProductionRefusalError);
    process.env.APP_ENV = "production";
    expect(() => new SyntheticTrackerSimulator({ environment: "test" })).toThrow(SyntheticTrackerProductionRefusalError);
    process.env.APP_ENV = "test";
    Reflect.set(process.env, "NODE_ENV", "production");
    expect(() => new SyntheticTrackerSimulator({ environment: "test" })).toThrow(SyntheticTrackerProductionRefusalError);
  });

  it("implements every required deterministic scenario without provider branding", () => {
    expect(SYNTHETIC_TRACKER_SCENARIOS).toHaveLength(27);
    const serialized = JSON.stringify(new SyntheticTrackerSimulator({ environment: "test", clock: () => now }).syntheticRawObservation());
    expect(serialized).toMatch(/SYNTHETIC/);
    expect(serialized).not.toMatch(/ctrack|netstar|cartrack|powerfleet/i);
  });

  it("normalizes units, timestamps and full synthetic provenance", () => {
    const simulator = new SyntheticTrackerSimulator({ environment: "test", clock: () => now });
    const result = simulator.normalizeCurrentObservation();
    expect(result.status).toBe("ACCEPTED");
    expect(result.position).toMatchObject({ speedKmh: 36, source: "SYNTHETIC", collectionMethod: "SIMULATOR", freshness: "FRESH", mappingState: "MAPPED", processingStatus: "ACCEPTED", synthetic: true });
    expect(result.position?.confidenceLimitations.join(" ")).toMatch(/synthetic/i);
    expect(speedToKmh(10, "MPH")).toBeCloseTo(16.09344);
    expect(distanceToKm(1, "MILES")).toBeCloseTo(1.609344);
  });

  it("quarantines poisoned numeric values and future communication timestamps", () => {
    const simulator = new SyntheticTrackerSimulator({ environment: "test", clock: () => now });
    const raw = simulator.syntheticRawObservation();
    const result = normalizeTrackerObservation({ ...raw, speed: -1, odometer: -1, headingDegrees: Number.NaN, accuracyMeters: Number.POSITIVE_INFINITY, fuelPercent: Number.NaN, lastCommunicationAt: new Date(now.getTime() + 10 * 60_000) }, { now, source: "SYNTHETIC", collectionMethod: "SIMULATOR", mappingState: "MAPPED", synthetic: true });
    expect(result.status).toBe("QUARANTINED");
    expect(result.reasons.join(" ")).toMatch(/future clock skew|negative|not finite/i);
  });

  it.each([
    ["IMPLAUSIBLE_JUMP", "IMPLAUSIBLE_LOCATION_CHANGE"],
    ["ODOMETER_ROLLBACK", "ODOMETER_ROLLBACK"],
    ["FUEL_DISCREPANCY", "FUEL_DISCREPANCY"],
    ["VEHICLE_REASSIGNMENT", "AMBIGUOUS_REASSIGNMENT"],
  ] as const)("emits a review-only quality signal for %s", (scenario, flag) => {
    const assessment = new SyntheticTrackerSimulator({ environment: "test", scenario, clock: () => now }).scenarioAssessment();
    expect(assessment.flags).toContain(flag);
    expect(assessment.limitation).toMatch(/human review|never proof/i);
  });

  it.each(["UNMAPPED", "INVALID_MAPPING", "MISSING_DATA", "PARTIAL_RESPONSE", "MALFORMED_PAYLOAD"] as const)("quarantines %s observations instead of guessing", (scenario) => {
    const simulator = new SyntheticTrackerSimulator({ environment: "test", scenario, clock: () => now });
    const result = simulator.normalizeCurrentObservation();
    expect(result.status).toBe("QUARANTINED");
    expect(result.position).toBeNull();
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("suppresses duplicates and classifies out-of-order and late events", () => {
    const seen = new Set<string>();
    const raw = new SyntheticTrackerSimulator({ environment: "test", clock: () => now }).syntheticRawObservation();
    const base = { now, source: "SYNTHETIC" as const, collectionMethod: "SIMULATOR" as const, mappingState: "MAPPED" as const, synthetic: true, seenEventIds: seen, providerEventId: "evt-1" };
    expect(normalizeTrackerObservation(raw, base).status).toBe("ACCEPTED");
    expect(normalizeTrackerObservation(raw, base).status).toBe("DUPLICATE");
    const prior = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const ordered = normalizeTrackerObservation({ ...raw, eventTime: prior, lastCommunicationAt: prior }, { ...base, providerEventId: "evt-2", latestAcceptedEventTime: now });
    expect(ordered).toMatchObject({ status: "ACCEPTED", outOfOrder: true, late: true });
  });

  it("paginates location history and preserves duplicate/out-of-order source events for ingestion controls", async () => {
    const simulator = new SyntheticTrackerSimulator({ environment: "test", scenario: "DUPLICATE_EVENT", clock: () => now, pageSizeLimit: 1 });
    const first = await simulator.listEvents(connection, "TRIPS", null, 50, request());
    const second = await simulator.listEvents(connection, "TRIPS", first.nextCursor, 50, request());
    expect(first.items).toHaveLength(1);
    expect(second.items[0]?.providerEventId).toBe(first.items[0]?.providerEventId);
  });

  it("rejects invalid signatures and replayed webhooks", () => {
    const simulator = new SyntheticTrackerSimulator({ environment: "test", clock: () => now });
    const body = JSON.stringify({ eventId: "synthetic-event-1" });
    expect(simulator.acceptSyntheticWebhook(connection, body, { "x-synthetic-signature": "invalid" })).toEqual({ accepted: false, reason: "INVALID_SIGNATURE" });
    const headers = { "x-synthetic-signature": simulator.signSyntheticWebhook(body) };
    expect(simulator.acceptSyntheticWebhook(connection, body, headers)).toEqual({ accepted: true, reason: "ACCEPTED" });
    expect(simulator.acceptSyntheticWebhook(connection, body, headers)).toEqual({ accepted: false, reason: "REPLAY" });
  });

  it("treats missing provider status as unknown and neutralizes log injection", async () => {
    const simulator = new SyntheticTrackerSimulator({ environment: "test", clock: () => now });
    const raw = { ...simulator.syntheticRawObservation(), online: undefined };
    expect(normalizeTrackerObservation(raw, { now, source: "SYNTHETIC", collectionMethod: "SIMULATOR", mappingState: "MAPPED", synthetic: true }).position?.online).toBeNull();
    await simulator.healthCheck(connection, { correlationId: "line\r\nforged", signal: new AbortController().signal });
    expect(simulator.safeLogs()[0]?.correlationId).toBe("invalid-correlation-id");
  });

  it("bounds timeout retries and recovers deterministically after a temporary outage", async () => {
    const timeout = new SyntheticTrackerSimulator({ environment: "test", scenario: "TIMEOUT", clock: () => now });
    const attempts: number[] = [];
    await expect(callTrackerWithPolicy({
      policy: { maxAttempts: 2, timeoutMs: 100, backoffMs: () => 0 },
      sleep: async () => undefined,
      onAttempt: ({ attempt }) => attempts.push(attempt),
      operation: (context) => timeout.latestPosition(connection, "SYNTHETIC-ASSET-001", context),
    })).rejects.toMatchObject({ classification: "TIMEOUT" });
    expect(attempts).toEqual([1, 2]);

    const recovery = new SyntheticTrackerSimulator({ environment: "test", scenario: "RECOVERY_AFTER_OUTAGE", clock: () => now });
    const sleep = vi.fn(async () => undefined);
    await expect(callTrackerWithPolicy({ sleep, operation: (context) => recovery.latestPosition(connection, "SYNTHETIC-ASSET-001", context) })).resolves.toMatchObject({ synthetic: true });
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("rejects cross-tenant mappings and credential use immediately after revocation", async () => {
    const crossTenant = new SyntheticTrackerSimulator({ environment: "test", scenario: "CROSS_TENANT_MAPPING", clock: () => now });
    await expect(crossTenant.healthCheck(connection, request())).rejects.toMatchObject({ classification: "AUTHORIZATION" });
    const simulator = new SyntheticTrackerSimulator({ environment: "test", clock: () => now });
    await simulator.revoke(connection);
    await expect(simulator.latestPosition(connection, "SYNTHETIC-ASSET-001", request())).rejects.toMatchObject({ classification: "REVOKED" });
  });

  it("passes the reusable adapter-neutral conformance harness", async () => {
    const signer = new SyntheticTrackerSimulator({ environment: "test", clock: () => now });
    const body = JSON.stringify({ eventId: "conformance-event" });
    let adapter: SyntheticTrackerSimulator | null = null;
    const report = await runTrackerConformanceSuite({
      createAdapter: () => { const created = new SyntheticTrackerSimulator({ environment: "test", clock: () => now }); adapter ??= created; return created; },
      createScenarioAdapter: (scenario) => new SyntheticTrackerSimulator({ environment: "test", scenario, clock: () => now }),
      connection,
      knownAssetId: "SYNTHETIC-ASSET-001",
      invalidSignatureHeaders: { "x-synthetic-signature": "invalid" },
      signedWebhook: { rawBody: body, headers: { "x-synthetic-signature": signer.signSyntheticWebhook(body) } },
      readAuditEvents: () => adapter?.safeAuditEvents() ?? [],
      readSafeLogs: () => adapter?.safeLogs() ?? [],
      acceptWebhook: (candidate, candidateConnection, rawBody, headers) => (candidate as SyntheticTrackerSimulator).acceptSyntheticWebhook(candidateConnection, rawBody, headers),
    });
    expect(report.passed).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(25);
  });
});
