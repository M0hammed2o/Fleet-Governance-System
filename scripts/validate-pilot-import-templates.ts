import fs from "node:fs/promises";
import { PILOT_IMPORT_TYPES, validatePilotImport } from "../src/lib/pilot/import-validator";

async function main() {
  const results = [];
  for (const type of PILOT_IMPORT_TYPES) {
    const csv = await fs.readFile(`pilot/import-templates/${type}.csv`, "utf8");
    const result = validatePilotImport(type, csv);
    results.push({ type, actor: result.actor, rows: result.records.length, valid: result.valid, errors: result.errors });
  }
  const failures = results.filter((result) => !result.valid);
  process.stdout.write(`${JSON.stringify({ status: failures.length === 0 ? "PASS" : "FAIL", templates: results }, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Pilot import template validation failed."}\n`);
  process.exitCode = 1;
});
