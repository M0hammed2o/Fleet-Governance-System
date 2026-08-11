import { config as loadEnv } from "dotenv";
import { buildProductionReadinessReport } from "../src/lib/operations/readiness-core";

loadEnv({ path: ".env", quiet: true });

const report = buildProductionReadinessReport(process.env, { database: "NOT_CHECKED" });
const json = process.argv.includes("--json");

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write("Genbridge production-readiness report\n");
  process.stdout.write(`Environment: ${report.environment}\n`);
  process.stdout.write(`Release ready: ${report.releaseReady ? "YES" : "NO"}\n`);
  process.stdout.write(`Code foundation ready: ${report.codeFoundationReady ? "YES" : "NO"}\n\n`);
  let currentCategory = "";
  for (const entry of report.items) {
    if (entry.category !== currentCategory) {
      currentCategory = entry.category;
      process.stdout.write(`${currentCategory}\n`);
    }
    process.stdout.write(`  [${entry.status}] ${entry.label}\n`);
    process.stdout.write(`    ${entry.message}\n`);
  }
  process.stdout.write("\nNo secret values are included in this report.\n");
}

process.exitCode = report.releaseReady ? 0 : 1;
