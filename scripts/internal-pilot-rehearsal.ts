import fs from "node:fs/promises";
import { validateUatCatalogue } from "../src/lib/pilot/uat-catalogue";
import { validatePhase17aRehearsalCases } from "../src/lib/pilot/internal-rehearsal";

async function main() {
  const baseInput = JSON.parse(await fs.readFile("pilot/uat-catalogue.json", "utf8")) as unknown;
  const phase17aInput = JSON.parse(await fs.readFile("pilot/phase17a-rehearsal-cases.json", "utf8")) as unknown;
  const base = validateUatCatalogue(baseInput);
  const phase17a = validatePhase17aRehearsalCases(phase17aInput);
  const errors = [...base.errors, ...phase17a.errors];
  const allIds = [...base.cases.map((entry) => entry.id), ...phase17a.cases.map((entry) => entry.id)];
  if (new Set(allIds).size !== allIds.length) errors.push("The combined rehearsal catalogue contains duplicate ids.");
  for (const testCase of phase17a.cases) {
    for (const reference of testCase.automatedEvidence) {
      try { await fs.access(reference); } catch { errors.push(`${testCase.id} references missing automated evidence: ${reference}.`); }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const byExecutionClass = Object.fromEntries(
    [...new Set(phase17a.cases.map((entry) => entry.executionClass))].sort().map((kind) => [kind, phase17a.cases.filter((entry) => entry.executionClass === kind).length]),
  );
  process.stdout.write(`${JSON.stringify({
    status: "CATALOGUE_VALIDATED",
    notice: "Automated evidence references are coverage, not human, emulator, physical-device, or customer execution results.",
    existingCases: base.cases.length,
    phase17aCases: phase17a.cases.length,
    totalCases: allIds.length,
    recordedExecutionResults: 0,
    byExecutionClass,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Internal rehearsal validation failed."}\n`);
  process.exitCode = 1;
});
