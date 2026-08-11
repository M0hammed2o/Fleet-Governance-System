import { execFileSync } from "node:child_process";
import fs from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const allowedEnvironmentFiles = new Set([".env.example", ".env.test.example"]);
const forbiddenEnvironmentFiles = tracked.filter(
  (file) => (file === ".env" || file.startsWith(".env.")) && !allowedEnvironmentFiles.has(file),
);
const forbiddenKeyFiles = tracked.filter((file) => /\.(pem|key|p12|pfx)$/i.test(file));

const privateNames = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "SESSION_SECRET",
  "MEDIA_URL_SIGNING_SECRET",
  "BIOMETRIC_TEMPLATE_ENCRYPTION_KEY",
  "JOB_SCHEDULER_TOKEN",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const publicLeaks = [];
for (const file of tracked.filter((name) => /\.(ts|tsx|js|mjs|json)$/i.test(name))) {
  const content = fs.readFileSync(file, "utf8");
  for (const name of privateNames) {
    if (content.includes(`NEXT_PUBLIC_${name}`)) publicLeaks.push(`${file}: NEXT_PUBLIC_${name}`);
  }
}

const failures = [...forbiddenEnvironmentFiles, ...forbiddenKeyFiles, ...publicLeaks];
if (failures.length > 0) {
  process.stderr.write("Secret staging check failed. Remove these tracked secret-bearing paths/references:\n");
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`Secret staging check passed (${tracked.length} tracked files inspected; values were not printed).\n`);
