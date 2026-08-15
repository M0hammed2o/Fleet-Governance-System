import fs from "node:fs/promises";
import path from "node:path";
import { buildInternalPilotReadinessReport, type InternalPilotEvidence } from "../src/lib/pilot/internal-pilot-readiness";

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return undefined; }
}

async function sourceContains(file: string, value: string): Promise<boolean> {
  try { return (await fs.readFile(file, "utf8")).includes(value); } catch { return false; }
}

async function main() {
  const root = path.resolve(process.env.INTERNAL_PILOT_EVIDENCE_DIR ?? ".data/internal-pilot-evidence");
  const [automatedGate, physicalAndroid, humanUat, defects, signoffEvidence] = await Promise.all([
    readJson<InternalPilotEvidence["automatedGate"]>(path.join(root, "automated-gate.json")),
    readJson<InternalPilotEvidence["physicalAndroid"]>(path.join(root, "physical-android.json")),
    readJson<InternalPilotEvidence["humanUat"]>(path.join(root, "human-uat.json")),
    readJson<InternalPilotEvidence["defects"]>(path.join(root, "defects.json")),
    readJson<{ signoffs?: InternalPilotEvidence["signoffs"]; handoverAuthorizer?: string }>(path.join(root, "signoffs.json")),
  ]);
  const report = buildInternalPilotReadinessReport({
    environment: process.env.APP_ENV ?? "development",
    catalogueCaseCount: 42,
    automatedGate,
    physicalAndroid,
    humanUat,
    defects,
    signoffs: signoffEvidence?.signoffs,
    handoverAuthorizer: signoffEvidence?.handoverAuthorizer,
    facialDisclosurePresent: await sourceContains("src/lib/facial-verification/contracts.ts", "SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION"),
    trackerDisclosurePresent: await sourceContains("PILOT_ONBOARDING_AND_UAT.md", "synthetic") && await sourceContains("PILOT_ONBOARDING_AND_UAT.md", "provider"),
  });
  process.stdout.write(`${JSON.stringify({ evidenceDirectory: root, ...report }, null, 2)}\n`);
  process.exitCode = report.ready ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Internal pilot readiness failed."}\n`);
  process.exitCode = 1;
});
