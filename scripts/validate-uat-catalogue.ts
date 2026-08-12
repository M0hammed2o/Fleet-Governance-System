import fs from "node:fs/promises";
import { validateUatCatalogue } from "../src/lib/pilot/uat-catalogue";

async function main() {
  const catalogue = JSON.parse(await fs.readFile("pilot/uat-catalogue.json", "utf8")) as unknown;
  const result = validateUatCatalogue(catalogue);
  if (!result.valid) throw new Error(result.errors.join("\n"));
  const modules = [...new Set(result.cases.map((entry) => entry.module))].sort();
  process.stdout.write(`${JSON.stringify({ status: "PASS", cases: result.cases.length, modules }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "UAT catalogue validation failed."}\n`);
  process.exitCode = 1;
});
