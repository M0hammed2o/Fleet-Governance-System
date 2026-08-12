import "server-only";
import {
  callTrackerWithPolicy,
  classifyTrackerFreshness,
  TrackerProviderError,
  validateVehicleMapping,
  type TrackerConnectionContext,
  type TrackerProviderAdapter,
  type TrackerRequestContext,
} from "@/lib/telematics/integration-contract";

export interface TrackerConformanceFixture {
  createAdapter(): TrackerProviderAdapter;
  createScenarioAdapter?(scenario: TrackerConformanceScenario): TrackerProviderAdapter;
  connection: TrackerConnectionContext;
  knownAssetId: string;
  invalidSignatureHeaders: Record<string, string | undefined>;
  signedWebhook?: { rawBody: string; headers: Record<string, string | undefined> };
  readAuditEvents?(): readonly { action: string; tenantId: string }[];
  readSafeLogs?(): readonly unknown[];
  acceptWebhook?(adapter: TrackerProviderAdapter, connection: TrackerConnectionContext, rawBody: string, headers: Record<string, string | undefined>): { accepted: boolean; reason: string };
}

export type TrackerConformanceScenario = "TIMEOUT" | "RATE_LIMIT" | "PARTIAL_RESPONSE" | "MALFORMED_PAYLOAD" | "DUPLICATE_EVENT" | "OUT_OF_ORDER_EVENT" | "LATE_EVENT" | "RECOVERY_AFTER_OUTAGE";

export interface TrackerConformanceCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface TrackerConformanceReport {
  passed: boolean;
  providerId: string;
  checks: TrackerConformanceCheck[];
}

function request(correlationId: string): TrackerRequestContext {
  return { correlationId, signal: new AbortController().signal };
}

export async function runTrackerConformanceSuite(fixture: TrackerConformanceFixture): Promise<TrackerConformanceReport> {
  const adapter = fixture.createAdapter();
  const checks: TrackerConformanceCheck[] = [];
  const check = (id: string, condition: boolean, detail: string) => checks.push({ id, passed: condition, detail });

  check("capability-discovery", adapter.capabilities().has("LATEST_POSITION"), "LATEST_POSITION must be declared before use.");
  const health = await adapter.healthCheck(fixture.connection, request("conformance-health"));
  check("authentication-boundary", health === true, "An authorised synthetic connection can perform a health check.");

  let crossTenantRejected = false;
  try {
    await adapter.healthCheck({ ...fixture.connection, tenantId: `foreign-${fixture.connection.tenantId}` }, request("conformance-cross-tenant"));
  } catch (error) {
    crossTenantRejected = error instanceof TrackerProviderError && error.classification === "AUTHORIZATION";
  }
  check("tenant-isolation", crossTenantRejected, "A foreign tenant connection is rejected with a typed authorization failure.");

  let pageCursor: string | null = null;
  const assetIds: string[] = [];
  do {
    const page = await adapter.listAssets(fixture.connection, pageCursor, 2, request("conformance-pagination"));
    assetIds.push(...page.items.map((entry) => entry.providerAssetId));
    pageCursor = page.nextCursor;
  } while (pageCursor !== null && assetIds.length < 100);
  check("bounded-pagination", assetIds.length > 1 && new Set(assetIds).size === assetIds.length && assetIds.length < 100, "Pagination terminates and yields unique assets.");

  const position = await adapter.latestPosition(fixture.connection, fixture.knownAssetId, request("conformance-position"));
  const positionValid = position.latitude >= -90 && position.latitude <= 90 && position.longitude >= -180 && position.longitude <= 180 && !Number.isNaN(position.gpsTimestamp.getTime());
  check("event-normalization", positionValid, "Coordinates and event time use the normalized contract.");
  check("provenance", Boolean(position.collectionMethod && position.mappingState && position.processingStatus && position.normalizedAt), "Normalized positions expose collection, mapping, processing and time provenance.");
  check("synthetic-label", position.synthetic && position.source === "SYNTHETIC" && position.confidenceLimitations.some((value) => /synthetic/i.test(value)), "Synthetic records cannot appear live.");
  check("freshness", classifyTrackerFreshness(position.lastCommunicationAt, position.receivedAt) === position.freshness, "Freshness is consistent with the common classifier.");

  let mappingRejected = false;
  try { validateVehicleMapping(fixture.connection, `foreign-${fixture.connection.tenantId}`, fixture.connection.providerId, fixture.knownAssetId); } catch { mappingRejected = true; }
  check("mapping-validation", mappingRejected, "Cross-tenant mapping validation rejects the request.");

  if (fixture.createScenarioAdapter) {
    const typedFailure = async (scenario: TrackerConformanceScenario, classification: string) => {
      try {
        const scenarioAdapter = fixture.createScenarioAdapter!(scenario);
        await callTrackerWithPolicy({
          correlationId: `conformance-${scenario.toLowerCase()}`,
          policy: { maxAttempts: 1, timeoutMs: 100, backoffMs: () => 0 },
          operation: (context) => scenarioAdapter.latestPosition(fixture.connection, fixture.knownAssetId, context),
        });
        return false;
      } catch (error) {
        return error instanceof TrackerProviderError && error.classification === classification;
      }
    };
    check("timeout-classification", await typedFailure("TIMEOUT", "TIMEOUT"), "Provider timeout is bounded by the request signal and classified without leaking internals.");
    check("rate-limit-classification", await typedFailure("RATE_LIMIT", "RATE_LIMIT"), "Rate limiting is a typed retryable failure.");
    check("partial-response-quarantine", await typedFailure("PARTIAL_RESPONSE", "INVALID_RESPONSE"), "Partial position data is rejected rather than guessed.");
    check("malformed-response-quarantine", await typedFailure("MALFORMED_PAYLOAD", "INVALID_RESPONSE"), "Malformed provider data is rejected rather than normalized into evidence.");

    const duplicatePage = await fixture.createScenarioAdapter("DUPLICATE_EVENT").listEvents(fixture.connection, "TRIPS", null, 100, request("conformance-duplicate"));
    check("duplicate-identification", duplicatePage.items.length > 1 && new Set(duplicatePage.items.map((entry) => entry.providerEventId)).size < duplicatePage.items.length, "Duplicate source events retain stable provider IDs for common idempotency suppression.");
    const outOfOrderPage = await fixture.createScenarioAdapter("OUT_OF_ORDER_EVENT").listEvents(fixture.connection, "TRIPS", null, 100, request("conformance-order"));
    check("out-of-order-identification", outOfOrderPage.items.some((entry, index) => index > 0 && entry.occurredAt < outOfOrderPage.items[index - 1].occurredAt), "Out-of-order source chronology remains detectable.");
    const latePage = await fixture.createScenarioAdapter("LATE_EVENT").listEvents(fixture.connection, "TRIPS", null, 100, request("conformance-late"));
    check("late-event-identification", latePage.items.some((entry) => position.receivedAt.getTime() - entry.occurredAt.getTime() > 24 * 60 * 60 * 1000), "Late source events retain their original event time.");

    let recoveryAttempts = 0;
    const recoveryAdapter = fixture.createScenarioAdapter("RECOVERY_AFTER_OUTAGE");
    const recovered = await callTrackerWithPolicy({
      policy: { maxAttempts: 3, timeoutMs: 500, backoffMs: () => 0 },
      sleep: async () => undefined,
      operation: async (context) => { recoveryAttempts += 1; return recoveryAdapter.latestPosition(fixture.connection, fixture.knownAssetId, context); },
    });
    check("outage-recovery", recovered.processingStatus === "ACCEPTED" && recoveryAttempts === 2, "A temporary outage recovers within bounded policy attempts.");
  }

  let attempts = 0;
  const sleeps: number[] = [];
  const retryResult = await callTrackerWithPolicy({
    correlationId: "conformance-retry",
    policy: { maxAttempts: 3, timeoutMs: 500, backoffMs: (attempt) => attempt * 10 },
    sleep: async (ms) => { sleeps.push(ms); },
    operation: async () => {
      attempts += 1;
      if (attempts < 3) throw new TrackerProviderError("RATE_LIMIT", "Synthetic retry gate.", true);
      return "recovered";
    },
  });
  check("bounded-retry-backoff", retryResult === "recovered" && attempts === 3 && sleeps.join(",") === "10,20", "Retries are bounded and backoff is observable.");

  check("webhook-invalid-signature", adapter.verifyWebhookSignature(fixture.connection, "{}", fixture.invalidSignatureHeaders) === false, "Invalid webhook signatures fail closed.");
  if (fixture.signedWebhook) {
    check("webhook-signature-boundary", adapter.verifyWebhookSignature(fixture.connection, fixture.signedWebhook.rawBody, fixture.signedWebhook.headers), "Fixture-signed webhook passes only the adapter boundary.");
    if (fixture.acceptWebhook) {
      const webhookAdapter = fixture.createAdapter();
      const first = fixture.acceptWebhook(webhookAdapter, fixture.connection, fixture.signedWebhook.rawBody, fixture.signedWebhook.headers);
      const replay = fixture.acceptWebhook(webhookAdapter, fixture.connection, fixture.signedWebhook.rawBody, fixture.signedWebhook.headers);
      check("webhook-replay-prevention", first.accepted && !replay.accepted && replay.reason === "REPLAY", "A valid webhook event is accepted once and replayed identity is rejected.");
    }
  }

  await adapter.writePollingCheckpoint(fixture.connection, "conformance-cursor");
  check("polling-idempotency", await adapter.readPollingCheckpoint(fixture.connection) === "conformance-cursor", "Polling checkpoint round-trip is deterministic.");
  await adapter.revoke(fixture.connection);
  let revoked = false;
  try { await adapter.latestPosition(fixture.connection, fixture.knownAssetId, request("conformance-revoked")); } catch (error) { revoked = error instanceof TrackerProviderError && error.classification === "REVOKED"; }
  check("safe-disablement-revocation", revoked && await adapter.connectionStatus(fixture.connection) === "REVOKED", "Revocation immediately disables reads.");

  if (fixture.readAuditEvents) {
    const auditEvents = fixture.readAuditEvents();
    check("audit-events", auditEvents.length > 0 && auditEvents.every((entry) => entry.tenantId === fixture.connection.tenantId), "Adapter lifecycle audit fixture is present and tenant-scoped.");
  }
  if (fixture.readSafeLogs) {
    const serialized = JSON.stringify(fixture.readSafeLogs());
    check("log-redaction", !serialized.match(/authorization|credential|secret|password|token/i), "Adapter logs contain no secret-bearing keys.");
  }

  return { passed: checks.every((entry) => entry.passed), providerId: adapter.providerId, checks };
}
