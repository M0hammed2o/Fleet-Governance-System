import { runTrackerConformanceSuite } from "../src/lib/telematics/conformance-suite";
import { SyntheticTrackerSimulator } from "../src/lib/telematics/synthetic-simulator";
import type { TrackerConnectionContext } from "../src/lib/telematics/integration-contract";

const connection: TrackerConnectionContext = {
  tenantId: "synthetic-tenant",
  connectionId: "synthetic-connection",
  providerId: "synthetic",
  customerAuthorizationReference: "SYNTHETIC-AUTHORIZATION-NOT-REAL",
  credentialVersion: 1,
};

async function main() {
  const webhookBody = JSON.stringify({ eventId: "synthetic-conformance-event" });
  const signer = new SyntheticTrackerSimulator({ environment: "test" });
  let adapter: SyntheticTrackerSimulator | null = null;
  const report = await runTrackerConformanceSuite({
    createAdapter: () => { const created = new SyntheticTrackerSimulator({ environment: "test" }); adapter ??= created; return created; },
    createScenarioAdapter: (scenario) => new SyntheticTrackerSimulator({ environment: "test", scenario }),
    connection,
    knownAssetId: "SYNTHETIC-ASSET-001",
    invalidSignatureHeaders: { "x-synthetic-signature": "invalid" },
    signedWebhook: { rawBody: webhookBody, headers: { "x-synthetic-signature": signer.signSyntheticWebhook(webhookBody) } },
    readAuditEvents: () => adapter?.safeAuditEvents() ?? [],
    readSafeLogs: () => adapter?.safeLogs() ?? [],
    acceptWebhook: (candidate, candidateConnection, rawBody, headers) => (candidate as SyntheticTrackerSimulator).acceptSyntheticWebhook(candidateConnection, rawBody, headers),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Tracker conformance failed."}\n`); process.exitCode = 1; });
