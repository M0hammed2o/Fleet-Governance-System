import { config as loadEnv } from "dotenv";
import { buildStagingReadinessReport } from "../src/lib/operations/staging-readiness";

loadEnv({ path: ".env", quiet: true });
const report = buildStagingReadinessReport(process.env);
if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  process.stdout.write("Genbridge non-deploying staging-readiness report\n");
  process.stdout.write(`Environment: ${report.environment}\nReady: ${report.ready ? "YES" : "NO"}\n\n`);
  for (const entry of report.items) process.stdout.write(`[${entry.status}] ${entry.id}: ${entry.message}\n`);
  process.stdout.write("\nNo secret values are included. This command does not deploy or create resources.\n");
}
process.exitCode = report.ready ? 0 : 1;
