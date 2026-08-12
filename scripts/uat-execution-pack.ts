import fs from "node:fs/promises";
import path from "node:path";
import { createUatExecutionPack, exportUatExecutionCsv, validateUatExecutionPack, type UatRehearsalClassification } from "../src/lib/pilot/uat-execution";
import { validateUatCatalogue } from "../src/lib/pilot/uat-catalogue";

async function main() {
 const command = process.argv[2] ?? "validate";
 const target = path.resolve(process.argv[3] ?? ".data/uat-execution-pack.json");
 const catalogueInput = JSON.parse(await fs.readFile("pilot/uat-catalogue.json", "utf8")) as unknown;

 if (command === "init") {
  const classifications = JSON.parse(await fs.readFile("pilot/uat-rehearsal-classifications.json", "utf8")) as UatRehearsalClassification[];
  const pack = createUatExecutionPack(catalogueInput, classifications);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(pack, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Created human UAT execution pack at ${path.relative(process.cwd(), target)}. No case was marked passed.\n`);
 } else {
  const packInput = JSON.parse(await fs.readFile(target, "utf8")) as unknown;
  const result = validateUatExecutionPack(packInput, catalogueInput);
  if (!result.valid || !result.pack) throw new Error(result.errors.join("\n"));
  if (command === "validate") {
    process.stdout.write(`${JSON.stringify({ status: "PASS", cases: result.pack.executions.length, humanEvents: result.pack.executions.flatMap((entry) => entry.events).length, notice: result.pack.notice }, null, 2)}\n`);
  } else if (command === "export") {
    const catalogue = validateUatCatalogue(catalogueInput);
    const exportPath = path.resolve(process.argv[4] ?? ".data/uat-execution-review.csv");
    await fs.mkdir(path.dirname(exportPath), { recursive: true });
    await fs.writeFile(exportPath, exportUatExecutionCsv(result.pack, catalogue.cases), { mode: 0o600 });
    process.stdout.write(`Exported review CSV to ${path.relative(process.cwd(), exportPath)}.\n`);
  } else {
    throw new Error("Usage: uat-execution-pack.ts init|validate|export [pack-path] [export-path]");
  }
 }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "UAT execution pack command failed."}\n`); process.exitCode = 1; });
