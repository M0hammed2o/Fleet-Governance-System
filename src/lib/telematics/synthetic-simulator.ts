import "server-only";
import crypto from "node:crypto";
import {
  TrackerProviderError,
  UnsupportedTrackerCapabilityError,
  type TrackerAsset,
  type TrackerCapability,
  type TrackerConnectionContext,
  type TrackerEvent,
  type TrackerPage,
  type TrackerPosition,
  type TrackerProviderAdapter,
  type TrackerRequestContext,
} from "@/lib/telematics/integration-contract";
import { normalizeTrackerObservation, type ProviderNeutralObservation } from "@/lib/telematics/normalization";

export const SYNTHETIC_TRACKER_SCENARIOS = [
  "HEALTHY_POSITION", "LOCATION_HISTORY", "UNMAPPED", "INVALID_MAPPING", "DUPLICATE_EVENT",
  "OUT_OF_ORDER_EVENT", "LATE_EVENT", "STALE_DATA", "MISSING_DATA", "IMPLAUSIBLE_JUMP",
  "ODOMETER_ROLLBACK", "FUEL_DISCREPANCY", "IGNITION_STATE", "GEOFENCE_ENTRY_EXIT",
  "DISCONNECTED", "TIMEOUT", "RATE_LIMIT", "AUTHENTICATION_FAILURE", "PARTIAL_RESPONSE",
  "MALFORMED_PAYLOAD", "WEBHOOK_REPLAY", "INVALID_WEBHOOK_SIGNATURE", "TEMPORARY_OUTAGE",
  "RECOVERY_AFTER_OUTAGE", "CREDENTIAL_REVOCATION", "VEHICLE_REASSIGNMENT", "CROSS_TENANT_MAPPING",
] as const;

export type SyntheticTrackerScenario = (typeof SYNTHETIC_TRACKER_SCENARIOS)[number];

export interface SyntheticTrackerLog {
  level: "INFO" | "WARN";
  operation: string;
  scenario: SyntheticTrackerScenario;
  correlationId: string;
  outcome: string;
}

export interface SyntheticTrackerAuditEvent { tenantId: string; action: string; scenario: SyntheticTrackerScenario }

export interface SyntheticTrackerSimulatorOptions {
  environment: "development" | "test" | "staging" | "production";
  scenario?: SyntheticTrackerScenario;
  clock?: () => Date;
  pageSizeLimit?: number;
}

const ASSET_ID = "SYNTHETIC-ASSET-001";
const WEBHOOK_KEY = "synthetic-local-test-key-not-a-real-secret";

function event(id: string, occurredAt: Date, type: TrackerEvent["type"], details: TrackerEvent["details"]): TrackerEvent {
  return { providerEventId: id, providerAssetId: ASSET_ID, occurredAt, type, idempotencyKey: `synthetic:${id}`, details };
}

export class SyntheticTrackerProductionRefusalError extends Error {
  constructor() {
    super("The synthetic tracker simulator is forbidden when APP_ENV or NODE_ENV is production.");
    this.name = "SyntheticTrackerProductionRefusalError";
  }
}

export class SyntheticTrackerSimulator implements TrackerProviderAdapter {
  readonly providerId = "synthetic" as const;
  readonly source = "SYNTHETIC" as const;
  private readonly clock: () => Date;
  private readonly pageSizeLimit: number;
  private scenario: SyntheticTrackerScenario;
  private revoked = new Set<string>();
  private checkpoints = new Map<string, string>();
  private acceptedWebhookIds = new Set<string>();
  private callCounts = new Map<string, number>();
  private readonly logs: SyntheticTrackerLog[] = [];
  private readonly auditEvents: SyntheticTrackerAuditEvent[] = [];
  private readonly supported = new Set<TrackerCapability>([
    "LATEST_POSITION", "IGNITION", "MOVEMENT", "ODOMETER", "TRIPS", "STOPS_AND_IDLING",
    "GEOFENCE_EVENTS", "DRIVING_EVENTS", "TAMPER_AND_POWER_ALERTS", "FUEL", "POLLING", "WEBHOOKS",
  ]);

  constructor(options: SyntheticTrackerSimulatorOptions) {
    if (options.environment === "production" || process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new SyntheticTrackerProductionRefusalError();
    }
    this.scenario = options.scenario ?? "HEALTHY_POSITION";
    this.clock = options.clock ?? (() => new Date("2030-01-15T10:00:00.000Z"));
    this.pageSizeLimit = Math.max(1, Math.min(options.pageSizeLimit ?? 2, 100));
  }

  setScenario(scenario: SyntheticTrackerScenario): void { this.scenario = scenario; }
  getScenario(): SyntheticTrackerScenario { return this.scenario; }
  safeLogs(): readonly SyntheticTrackerLog[] { return this.logs; }
  safeAuditEvents(): readonly SyntheticTrackerAuditEvent[] { return this.auditEvents; }
  capabilities(): ReadonlySet<TrackerCapability> { return this.supported; }

  private record(operation: string, request: TrackerRequestContext | null, outcome: string, level: "INFO" | "WARN" = "INFO"): void {
    const candidate = request?.correlationId ?? "not-applicable";
    const correlationId = /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate) ? candidate : "invalid-correlation-id";
    this.logs.push({ level, operation, scenario: this.scenario, correlationId, outcome });
  }

  private count(operation: string): number {
    const next = (this.callCounts.get(operation) ?? 0) + 1;
    this.callCounts.set(operation, next);
    return next;
  }

  private assertConnection(connection: TrackerConnectionContext): void {
    if (connection.providerId !== "synthetic" || !connection.tenantId || !connection.connectionId) {
      throw new TrackerProviderError("AUTHORIZATION", "Synthetic tracker connection boundary is invalid.", false);
    }
    if (this.scenario === "CROSS_TENANT_MAPPING" || connection.tenantId.startsWith("foreign-")) {
      throw new TrackerProviderError("AUTHORIZATION", "Cross-tenant tracker access was rejected.", false);
    }
    if (this.scenario === "AUTHENTICATION_FAILURE") {
      throw new TrackerProviderError("AUTHENTICATION", "Synthetic authentication failure.", false);
    }
    if (this.revoked.has(connection.connectionId) || this.scenario === "CREDENTIAL_REVOCATION") {
      throw new TrackerProviderError("REVOKED", "Synthetic tracker credential is revoked.", false);
    }
  }

  private maybeUnavailable(operation: string, request: TrackerRequestContext): void {
    const attempt = this.count(operation);
    if (this.scenario === "RATE_LIMIT") throw new TrackerProviderError("RATE_LIMIT", "Synthetic rate limit reached.", true);
    if (this.scenario === "TEMPORARY_OUTAGE") throw new TrackerProviderError("UNAVAILABLE", "Synthetic temporary outage.", true);
    if (this.scenario === "RECOVERY_AFTER_OUTAGE" && attempt === 1) throw new TrackerProviderError("UNAVAILABLE", "Synthetic first-attempt outage.", true);
    if (this.scenario === "DISCONNECTED") throw new TrackerProviderError("UNAVAILABLE", "Synthetic tracker is disconnected.", false);
    this.record(operation, request, attempt > 1 ? "recovered" : "ok");
  }

  async connectionStatus(connection: TrackerConnectionContext): Promise<"CONNECTED" | "DEGRADED" | "REVOKED"> {
    if (this.revoked.has(connection.connectionId) || this.scenario === "CREDENTIAL_REVOCATION") return "REVOKED";
    if (["DISCONNECTED", "TEMPORARY_OUTAGE", "RECOVERY_AFTER_OUTAGE", "RATE_LIMIT", "TIMEOUT"].includes(this.scenario)) return "DEGRADED";
    this.assertConnection(connection);
    return "CONNECTED";
  }

  async healthCheck(connection: TrackerConnectionContext, request: TrackerRequestContext): Promise<boolean> {
    this.assertConnection(connection);
    this.maybeUnavailable("healthCheck", request);
    return true;
  }

  async listAssets(connection: TrackerConnectionContext, cursor: string | null, pageSize: number, request: TrackerRequestContext): Promise<TrackerPage<TrackerAsset>> {
    this.assertConnection(connection);
    this.maybeUnavailable("listAssets", request);
    const all = [1, 2, 3].map((index) => ({ providerAssetId: `SYNTHETIC-ASSET-00${index}`, registrationNumber: `SYN-00${index}-TEST` }));
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0) throw new TrackerProviderError("INVALID_RESPONSE", "Synthetic cursor is invalid.", false);
    const bounded = Math.max(1, Math.min(pageSize, this.pageSizeLimit));
    const items = all.slice(offset, offset + bounded);
    const next = offset + items.length;
    return { items, nextCursor: next < all.length ? String(next) : null, rateLimit: { remaining: 99, resetsAt: new Date(this.clock().getTime() + 60_000) } };
  }

  syntheticRawObservation(): ProviderNeutralObservation {
    const now = this.clock();
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const base: ProviderNeutralObservation = {
      providerAssetId: ASSET_ID,
      latitude: 0.123456,
      longitude: 0.654321,
      eventTime: this.scenario === "STALE_DATA" ? stale : now,
      lastCommunicationAt: this.scenario === "STALE_DATA" ? stale : now,
      online: this.scenario !== "DISCONNECTED",
      ignitionOn: this.scenario === "IGNITION_STATE" ? false : true,
      moving: true,
      speed: 10,
      speedUnit: "MPS",
      headingDegrees: 90,
      odometer: this.scenario === "ODOMETER_ROLLBACK" ? 9_000 : 12_345,
      odometerUnit: "KM",
      accuracyMeters: 8,
      fuelPercent: this.scenario === "FUEL_DISCREPANCY" ? 15 : 75,
      driverReference: "SYNTHETIC-DRIVER-001",
    };
    if (this.scenario === "MISSING_DATA" || this.scenario === "PARTIAL_RESPONSE") base.latitude = undefined;
    if (this.scenario === "MALFORMED_PAYLOAD") { base.latitude = 999; base.eventTime = "not-a-time"; }
    if (this.scenario === "IMPLAUSIBLE_JUMP") { base.latitude = -70; base.longitude = 150; }
    if (this.scenario === "INVALID_MAPPING") base.providerAssetId = "";
    return base;
  }

  normalizeCurrentObservation(mappingState: "MAPPED" | "UNMAPPED" | "AMBIGUOUS" | "REVOKED" = "MAPPED") {
    const state = this.scenario === "UNMAPPED" ? "UNMAPPED" : this.scenario === "VEHICLE_REASSIGNMENT" ? "AMBIGUOUS" : mappingState;
    return normalizeTrackerObservation(this.syntheticRawObservation(), { now: this.clock(), source: "SYNTHETIC", collectionMethod: "SIMULATOR", mappingState: state, synthetic: true });
  }

  scenarioAssessment(): { flags: string[]; limitation: string } {
    const flags: string[] = [];
    if (this.scenario === "IMPLAUSIBLE_JUMP") flags.push("IMPLAUSIBLE_LOCATION_CHANGE");
    if (this.scenario === "ODOMETER_ROLLBACK") flags.push("ODOMETER_ROLLBACK");
    if (this.scenario === "FUEL_DISCREPANCY") flags.push("FUEL_DISCREPANCY");
    if (this.scenario === "VEHICLE_REASSIGNMENT") flags.push("AMBIGUOUS_REASSIGNMENT");
    return { flags, limitation: "Synthetic data-quality signal requiring human review; never proof of misconduct." };
  }

  async latestPosition(connection: TrackerConnectionContext, providerAssetId: string, request: TrackerRequestContext): Promise<TrackerPosition> {
    this.assertConnection(connection);
    if (providerAssetId !== ASSET_ID) throw new TrackerProviderError("AUTHORIZATION", "Synthetic asset mapping is invalid.", false);
    if (this.scenario === "TIMEOUT") {
      return new Promise<TrackerPosition>((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new TrackerProviderError("TIMEOUT", "Synthetic timeout.", true)), { once: true }));
    }
    this.maybeUnavailable("latestPosition", request);
    const result = this.normalizeCurrentObservation();
    if (!result.position) throw new TrackerProviderError("INVALID_RESPONSE", `Synthetic observation quarantined: ${result.reasons.join("; ")}`, false);
    return result.position;
  }

  private scenarioEvents(capability: TrackerCapability): TrackerEvent[] {
    const now = this.clock();
    const minutes = (value: number) => new Date(now.getTime() + value * 60_000);
    if (this.scenario === "GEOFENCE_ENTRY_EXIT" || capability === "GEOFENCE_EVENTS") return [event("geo-1", minutes(-10), "GEOFENCE", { transition: "ENTRY", synthetic: true }), event("geo-2", minutes(-5), "GEOFENCE", { transition: "EXIT", synthetic: true })];
    const history = [event("position-1", minutes(-20), "TRIP", { latitude: 0.12, longitude: 0.65, synthetic: true }), event("position-2", minutes(-10), "TRIP", { latitude: 0.123, longitude: 0.653, synthetic: true }), event("position-3", now, "TRIP", { latitude: 0.123456, longitude: 0.654321, synthetic: true })];
    if (this.scenario === "DUPLICATE_EVENT") return [history[0], history[0]];
    if (this.scenario === "OUT_OF_ORDER_EVENT") return [history[2], history[0], history[1]];
    if (this.scenario === "LATE_EVENT") return [event("late-1", minutes(-2_000), "TRIP", { late: true, synthetic: true })];
    return history;
  }

  async listEvents(connection: TrackerConnectionContext, capability: TrackerCapability, cursor: string | null, pageSize: number, request: TrackerRequestContext): Promise<TrackerPage<TrackerEvent>> {
    this.assertConnection(connection);
    if (!this.supported.has(capability)) throw new UnsupportedTrackerCapabilityError(capability);
    this.maybeUnavailable("listEvents", request);
    const all = this.scenarioEvents(capability);
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0) throw new TrackerProviderError("INVALID_RESPONSE", "Synthetic cursor is invalid.", false);
    const bounded = Math.max(1, Math.min(pageSize, this.pageSizeLimit));
    const items = all.slice(offset, offset + bounded);
    const next = offset + items.length;
    return { items, nextCursor: next < all.length ? String(next) : null, rateLimit: { remaining: 99, resetsAt: new Date(this.clock().getTime() + 60_000) } };
  }

  signSyntheticWebhook(rawBody: string): string { return crypto.createHmac("sha256", WEBHOOK_KEY).update(rawBody).digest("hex"); }

  verifyWebhookSignature(connection: TrackerConnectionContext, rawBody: string, headers: Record<string, string | undefined>): boolean {
    this.assertConnection(connection);
    const supplied = headers["x-synthetic-signature"];
    if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
    const expected = this.signSyntheticWebhook(rawBody);
    return crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
  }

  acceptSyntheticWebhook(connection: TrackerConnectionContext, rawBody: string, headers: Record<string, string | undefined>): { accepted: boolean; reason: string } {
    this.assertConnection(connection);
    if (!this.verifyWebhookSignature(connection, rawBody, headers) || this.scenario === "INVALID_WEBHOOK_SIGNATURE") return { accepted: false, reason: "INVALID_SIGNATURE" };
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { return { accepted: false, reason: "MALFORMED_PAYLOAD" }; }
    const eventId = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).eventId === "string" ? (payload as Record<string, string>).eventId : "";
    if (!eventId) return { accepted: false, reason: "MISSING_EVENT_ID" };
    if (this.acceptedWebhookIds.has(eventId) || this.scenario === "WEBHOOK_REPLAY") return { accepted: false, reason: "REPLAY" };
    this.acceptedWebhookIds.add(eventId);
    return { accepted: true, reason: "ACCEPTED" };
  }

  async readPollingCheckpoint(connection: TrackerConnectionContext): Promise<string | null> { this.assertConnection(connection); return this.checkpoints.get(connection.connectionId) ?? null; }
  async writePollingCheckpoint(connection: TrackerConnectionContext, checkpoint: string): Promise<void> {
    this.assertConnection(connection);
    if (!checkpoint || checkpoint.length > 500) throw new TrackerProviderError("INVALID_RESPONSE", "Polling checkpoint is invalid.", false);
    this.checkpoints.set(connection.connectionId, checkpoint);
    this.auditEvents.push({ tenantId: connection.tenantId, action: "syntheticTracker.checkpointWritten", scenario: this.scenario });
  }
  async rotateCredential(connection: TrackerConnectionContext, nextCredentialVersion: number): Promise<void> {
    this.assertConnection(connection);
    if (nextCredentialVersion <= connection.credentialVersion) throw new TrackerProviderError("AUTHENTICATION", "Credential version must increase.", false);
  }
  async revoke(connection: TrackerConnectionContext): Promise<void> { this.revoked.add(connection.connectionId); this.checkpoints.delete(connection.connectionId); this.auditEvents.push({ tenantId: connection.tenantId, action: "syntheticTracker.revoked", scenario: this.scenario }); }
}
