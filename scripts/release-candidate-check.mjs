import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const startedAt = new Date();
const steps = [];
let failed = false;

function run(label, command, expectedExit = 0) {
  const started = Date.now();
  process.stdout.write(`\n[release-candidate] ${label}\n`);
  const result = spawnSync(command, { shell: true, stdio: "inherit", env: { ...process.env, SEED_SUPPRESS_CREDENTIAL_OUTPUT: "true" } });
  const exitCode = result.status ?? 1;
  const passed = !result.error && exitCode === expectedExit;
  steps.push({ label, command, expectedExit, exitCode, passed, durationMs: Date.now() - started });
  if (!passed) {
    failed = true;
    process.stderr.write(`[release-candidate] FAIL: ${label} (expected ${expectedExit}, received ${exitCode})\n`);
  }
  return passed;
}

run("clean Git state", "node scripts/verify-clean-worktree.mjs");
run("package/lock integrity", "npm ci --dry-run --ignore-scripts && npm ls --all");
run("Prisma formatting", "npx prisma format --check");
run("Prisma validation and generation", "npx prisma validate && npx prisma generate");
run("Prisma migration status", "npx prisma migrate status");
run("empty-database migration replay", "npm run verify:clean-migrations");
run("isolated backup and restore", "npm run verify:backup-restore");
run("TypeScript", "npx tsc --noEmit");
run("ESLint", "npm run lint");
run("Vitest", "npm test");
run("production build", "npm run build");
run("pilot seed/reset/idempotency boundaries", "npm run pilot:test-boundaries");
run("pilot invariant verification", "npm run pilot:verify");
run("pilot import templates", "npm run pilot:imports:validate");
run("UAT catalogue", "npm run pilot:uat:validate");
run("Playwright", "npx playwright test");
run("secret and staged-environment scan", "npm run security:scan");
run("dependency audit", "npm audit --audit-level=moderate");
run("production readiness remains fail-closed", "npm run production:check", 1);
run("pilot performance regression probe", "npm run performance:pilot");
run("final clean Git state", "node scripts/verify-clean-worktree.mjs");

const head = spawnSync("git rev-parse HEAD", { shell: true, encoding: "utf8" }).stdout?.trim() || "unknown";
const summary = {
  status: failed ? "FAIL" : "PASS",
  localOnly: true,
  deployed: false,
  productionReadinessExpectedBlocked: true,
  head,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  steps,
  notice: "This evidence is local engineering verification, not business, legal, privacy, security or deployment approval.",
};
const evidencePath = path.resolve(".data", "phase14a-release-candidate-evidence.json");
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`\n[release-candidate] ${summary.status}; local evidence written beneath ignored .data.\n`);
process.exitCode = failed ? 1 : 0;
