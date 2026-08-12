import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const startedAt = new Date();
const steps = [];
let failed = false;
const uatPack = `.data/staging-uat-execution-${process.pid}.json`;

function run(label, command, expectedExit = 0) {
  const started = Date.now();
  process.stdout.write(`\n[staging-release] ${label}\n`);
  const result = spawnSync(command, { shell: true, stdio: "inherit", env: { ...process.env, SEED_SUPPRESS_CREDENTIAL_OUTPUT: "true" } });
  const exitCode = result.status ?? 1;
  const passed = !result.error && exitCode === expectedExit;
  steps.push({ label, command, expectedExit, exitCode, passed, durationMs: Date.now() - started });
  if (!passed) { failed = true; process.stderr.write(`[staging-release] FAIL: ${label} (expected ${expectedExit}, received ${exitCode})\n`); }
}

const head = spawnSync("git rev-parse HEAD", { shell: true, encoding: "utf8" }).stdout?.trim() || "unknown";
run("approved immutable commit exists", `git cat-file -e ${head}`);
run("clean source state", "node scripts/verify-clean-worktree.mjs");
run("package/lock integrity", "npm ci --dry-run --ignore-scripts && npm ls --all");
run("Prisma format", "npx prisma format --check");
run("Prisma validate/generate/status", "npx prisma validate && npx prisma generate && npx prisma migrate status");
run("empty migration replay", "npm run verify:clean-migrations");
run("isolated backup/restore", "npm run verify:backup-restore");
run("TypeScript", "npx tsc --noEmit");
run("ESLint", "npm run lint");
run("unit/integration", "npm test");
run("production build", "npm run build");
run("synthetic pilot boundaries", "npm run pilot:test-boundaries && npm run pilot:verify && npm run pilot:imports:validate");
run("provider contract conformance", "npm run tracker:conformance");
run("UAT catalogue", "npm run pilot:uat:validate");
run("UAT execution pack initialisation", `npm run pilot:uat:execution:init -- ${uatPack}`);
run("UAT execution pack validation", `npm run pilot:uat:execution:validate -- ${uatPack}`);
run("Playwright responsive/accessibility workflows", "npx playwright test");
run("secret/environment scan", "npm run security:scan");
run("dependency audit", "npm audit --audit-level=moderate");
run("production readiness remains blocked", "npm run production:check", 1);
run("staging readiness remains blocked without approvals", "npm run staging:check", 1);
run("pilot performance regression", "npm run performance:pilot");
run("container build/non-root/liveness", "npm run pilot:docker:smoke");
run("rollback and approval documents exist", "node -e \"const f=require('fs');['STAGING_ENVIRONMENT_PLAN.md','PHASE15_BUSINESS_LEGAL_AND_OPERATIONAL_DECISIONS.md','HUMAN_UAT_EXECUTION_GUIDE.md'].forEach(p=>{if(!f.existsSync(p))process.exit(1)})\"");
run("final clean source state", "node scripts/verify-clean-worktree.mjs");

if (fs.existsSync(uatPack)) fs.unlinkSync(uatPack);
const summary = { status: failed ? "FAIL" : "PASS", localOnly: true, deployed: false, externalConnections: false, productionReadinessExpectedBlocked: true, stagingReadinessExpectedBlocked: true, head, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), steps, notice: "Local non-deploying engineering evidence; not business, legal, privacy, security, staging or production approval." };
const evidencePath = path.resolve(".data", "phase15a-staging-release-evidence.json");
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`\n[staging-release] ${summary.status}; local evidence written beneath ignored .data. No deployment was attempted.\n`);
process.exitCode = failed ? 1 : 0;
