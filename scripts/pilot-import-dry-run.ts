import fs from "node:fs/promises";
import path from "node:path";
import { PILOT_IMPORT_TYPES, type PilotImportType, validatePilotImport } from "../src/lib/pilot/import-validator";

async function main() {
  const requested = process.argv[2];
  if (!PILOT_IMPORT_TYPES.includes(requested as PilotImportType)) throw new Error(`Usage: npm run pilot:import:dry -- <${PILOT_IMPORT_TYPES.join("|")}> [csv-path]`);
  const type = requested as PilotImportType;
  const suppliedPath = process.argv[3];
  const filePath = path.resolve(process.cwd(), suppliedPath ?? `pilot/import-templates/${type}.csv`);
  const templatesRoot = path.resolve(process.cwd(), "pilot/import-templates");
  if (!suppliedPath && !filePath.startsWith(`${templatesRoot}${path.sep}`)) throw new Error("Default import template escaped its expected directory.");
  const result = validatePilotImport(type, await fs.readFile(filePath, "utf8"));
  process.stdout.write(`${JSON.stringify({ result: result.valid ? "PASS" : "FAIL", ...result, records: result.valid ? result.records : undefined }, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Pilot import dry-run failed."}\n`);
  process.exitCode = 1;
});
