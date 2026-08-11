import "server-only";
import crypto from "node:crypto";

export const TRACKER_PROVIDER_IDS = ["cartrack", "netstar", "tracker", "ctrack", "mix-powerfleet", "synthetic"] as const;
export type TrackerProviderId = (typeof TRACKER_PROVIDER_IDS)[number];

export type TrackerCapability =
  | "LATEST_POSITION"
  | "IGNITION"
  | "MOVEMENT"
  | "ODOMETER"
  | "TRIPS"
  | "STOPS_AND_IDLING"
  | "GEOFENCE_EVENTS"
  | "DRIVING_EVENTS"
  | "TAMPER_AND_POWER_ALERTS"
  | "FUEL"
  | "DIAGNOSTICS"
  | "WEBHOOKS"
  | "POLLING";

export type TrackerDataSource = "MOCK" | "LIVE" | "MANUAL" | "UNAVAILABLE";
export type TrackerFreshness = "FRESH" | "STALE" | "UNAVAILABLE";
export type TrackerErrorClassification = "AUTHENTICATION" | "AUTHORIZATION" | "RATE_LIMIT" | "TIMEOUT" | "UNAVAILABLE" | "INVALID_RESPONSE" | "REVOKED" | "UNSUPPORTED";

export interface TrackerConnectionContext {
  tenantId: string;
  connectionId: string;
  providerId: TrackerProviderId;
  customerAuthorizationReference: string;
  credentialVersion: number;
}

export interface TrackerRequestContext {
  correlationId: string;
  signal: AbortSignal;
}

export interface TrackerAsset {
  providerAssetId: string;
  registrationNumber?: string;
}

export interface TrackerPosition {
  providerAssetId: string;
  latitude: number;
  longitude: number;
  gpsTimestamp: Date;
  lastCommunicationAt: Date;
  online: boolean;
  ignitionOn: boolean | null;
  moving: boolean | null;
  speedKmh: number | null;
  headingDegrees: number | null;
  odometerKm: number | null;
  fuelPercent?: number | null;
  diagnosticCodes?: string[];
  source: TrackerDataSource;
}

export interface TrackerPage<T> {
  items: T[];
  nextCursor: string | null;
  rateLimit: { remaining: number | null; resetsAt: Date | null };
}

export interface TrackerEvent {
  providerEventId: string;
  providerAssetId: string;
  occurredAt: Date;
  type: "TRIP" | "STOP" | "IDLING" | "GEOFENCE" | "DRIVING" | "TAMPER" | "POWER";
  idempotencyKey: string;
  details: Record<string, string | number | boolean | null>;
}

export class TrackerProviderError extends Error {
  constructor(
    readonly classification: TrackerErrorClassification,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TrackerProviderError";
  }
}

export class UnsupportedTrackerCapabilityError extends TrackerProviderError {
  constructor(capability: TrackerCapability) {
    super("UNSUPPORTED", `Tracker capability ${capability} is not supported by this adapter.`, false);
    this.name = "UnsupportedTrackerCapabilityError";
  }
}

export interface TrackerProviderAdapter {
  readonly providerId: TrackerProviderId;
  readonly source: TrackerDataSource;
  capabilities(): ReadonlySet<TrackerCapability>;
  connectionStatus(connection: TrackerConnectionContext): Promise<"CONNECTED" | "DEGRADED" | "REVOKED">;
  healthCheck(connection: TrackerConnectionContext, request: TrackerRequestContext): Promise<boolean>;
  listAssets(connection: TrackerConnectionContext, cursor: string | null, pageSize: number, request: TrackerRequestContext): Promise<TrackerPage<TrackerAsset>>;
  latestPosition(connection: TrackerConnectionContext, providerAssetId: string, request: TrackerRequestContext): Promise<TrackerPosition>;
  listEvents(connection: TrackerConnectionContext, capability: TrackerCapability, cursor: string | null, pageSize: number, request: TrackerRequestContext): Promise<TrackerPage<TrackerEvent>>;
  verifyWebhookSignature(connection: TrackerConnectionContext, rawBody: string, headers: Record<string, string | undefined>): boolean;
  readPollingCheckpoint(connection: TrackerConnectionContext): Promise<string | null>;
  writePollingCheckpoint(connection: TrackerConnectionContext, checkpoint: string): Promise<void>;
  rotateCredential(connection: TrackerConnectionContext, nextCredentialVersion: number): Promise<void>;
  revoke(connection: TrackerConnectionContext): Promise<void>;
}

export interface TrackerRetryPolicy {
  maxAttempts: number;
  timeoutMs: number;
  backoffMs(attempt: number): number;
}

export const DEFAULT_TRACKER_RETRY_POLICY: TrackerRetryPolicy = {
  maxAttempts: 3,
  timeoutMs: 10_000,
  backoffMs: (attempt) => Math.min(250 * 2 ** (attempt - 1), 2_000),
};

export function classifyTrackerFreshness(lastCommunicationAt: Date | null, now = new Date(), staleAfterMs = 30 * 60 * 1000): TrackerFreshness {
  if (!lastCommunicationAt) return "UNAVAILABLE";
  return now.getTime() - lastCommunicationAt.getTime() > staleAfterMs ? "STALE" : "FRESH";
}

export function validateVehicleMapping(connection: TrackerConnectionContext, tenantId: string, providerId: TrackerProviderId, providerAssetId: string): void {
  if (connection.tenantId !== tenantId || connection.providerId !== providerId || !providerAssetId.trim()) {
    throw new TrackerProviderError("AUTHORIZATION", "Tracker vehicle mapping does not belong to this tenant/provider connection.", false);
  }
}

export async function callTrackerWithPolicy<T>(input: {
  operation: (request: TrackerRequestContext) => Promise<T>;
  policy?: TrackerRetryPolicy;
  correlationId?: string;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (metadata: { correlationId: string; attempt: number; outcome: "success" | "retry" | "failure" }) => void;
}): Promise<T> {
  const policy = input.policy ?? DEFAULT_TRACKER_RETRY_POLICY;
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 3) throw new Error("Tracker retry attempts must be between 1 and 3.");
  if (policy.timeoutMs < 100 || policy.timeoutMs > 30_000) throw new Error("Tracker request timeout must be between 100ms and 30000ms.");
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const result = await Promise.race([
        input.operation({ correlationId, signal: controller.signal }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new TrackerProviderError("TIMEOUT", "Tracker request timed out.", true)), { once: true })),
      ]);
      input.onAttempt?.({ correlationId, attempt, outcome: "success" });
      return result;
    } catch (error) {
      const normalized = error instanceof TrackerProviderError ? error : new TrackerProviderError("UNAVAILABLE", "Tracker provider request failed.", true);
      const retry = normalized.retryable && attempt < policy.maxAttempts;
      input.onAttempt?.({ correlationId, attempt, outcome: retry ? "retry" : "failure" });
      if (!retry) throw normalized;
      await sleep(policy.backoffMs(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new TrackerProviderError("UNAVAILABLE", "Tracker provider request failed.", false);
}

export class SyntheticTrackerAdapter implements TrackerProviderAdapter {
  readonly providerId = "synthetic" as const;
  readonly source = "MOCK" as const;
  private revoked = new Set<string>();
  private credentialVersions = new Map<string, number>();
  private checkpoints = new Map<string, string>();
  private readonly supported = new Set<TrackerCapability>(["LATEST_POSITION", "IGNITION", "MOVEMENT", "ODOMETER", "POLLING"]);

  capabilities(): ReadonlySet<TrackerCapability> { return this.supported; }
  private assertActive(connection: TrackerConnectionContext): void {
    if (this.revoked.has(connection.connectionId)) throw new TrackerProviderError("REVOKED", "Tracker connection has been revoked.", false);
    if (connection.tenantId.length === 0 || connection.providerId !== this.providerId) throw new TrackerProviderError("AUTHORIZATION", "Tracker connection boundary is invalid.", false);
  }
  async connectionStatus(connection: TrackerConnectionContext) { return this.revoked.has(connection.connectionId) ? "REVOKED" as const : "CONNECTED" as const; }
  async healthCheck(connection: TrackerConnectionContext): Promise<boolean> { this.assertActive(connection); return true; }
  async listAssets(connection: TrackerConnectionContext, cursor: string | null, pageSize: number): Promise<TrackerPage<TrackerAsset>> {
    this.assertActive(connection);
    const bounded = Math.max(1, Math.min(pageSize, 100));
    const offset = cursor ? Number(cursor) : 0;
    const all = [{ providerAssetId: "synthetic-vehicle-1", registrationNumber: "SYN-001" }];
    return { items: all.slice(offset, offset + bounded), nextCursor: null, rateLimit: { remaining: null, resetsAt: null } };
  }
  async latestPosition(connection: TrackerConnectionContext, providerAssetId: string, request: TrackerRequestContext): Promise<TrackerPosition> {
    void request;
    this.assertActive(connection);
    const now = new Date("2026-08-11T12:00:00.000Z");
    return { providerAssetId, latitude: -26.2041, longitude: 28.0473, gpsTimestamp: now, lastCommunicationAt: now, online: true, ignitionOn: true, moving: true, speedKmh: 42, headingDegrees: 90, odometerKm: 12_345, source: "MOCK" };
  }
  async listEvents(connection: TrackerConnectionContext, capability: TrackerCapability, cursor: string | null, pageSize: number, request: TrackerRequestContext): Promise<TrackerPage<TrackerEvent>> {
    void cursor;
    void pageSize;
    void request;
    this.assertActive(connection);
    if (!this.supported.has(capability)) throw new UnsupportedTrackerCapabilityError(capability);
    return { items: [], nextCursor: null, rateLimit: { remaining: null, resetsAt: null } };
  }
  verifyWebhookSignature(): boolean { return false; }
  async readPollingCheckpoint(connection: TrackerConnectionContext): Promise<string | null> { this.assertActive(connection); return this.checkpoints.get(connection.connectionId) ?? null; }
  async writePollingCheckpoint(connection: TrackerConnectionContext, checkpoint: string): Promise<void> { this.assertActive(connection); this.checkpoints.set(connection.connectionId, checkpoint); }
  async rotateCredential(connection: TrackerConnectionContext, nextCredentialVersion: number): Promise<void> {
    this.assertActive(connection);
    if (nextCredentialVersion <= connection.credentialVersion) throw new TrackerProviderError("AUTHENTICATION", "Credential version must increase during rotation.", false);
    this.credentialVersions.set(connection.connectionId, nextCredentialVersion);
  }
  async revoke(connection: TrackerConnectionContext): Promise<void> { this.revoked.add(connection.connectionId); this.checkpoints.delete(connection.connectionId); this.credentialVersions.delete(connection.connectionId); }
}
