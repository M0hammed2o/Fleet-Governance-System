import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const startedAt = new Date();
const steps = [];
let failed = false;
const uatPack = `.data/phase16a-uat-execution-${process.pid}.json`;

function run(label, command, expectedExit = 0) {
  const started = Date.now();
  process.stdout.write(`\n[phase16a-mobile] ${label}\n`);
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, SEED_SUPPRESS_CREDENTIAL_OUTPUT: "true" },
  });
  const exitCode = result.status ?? 1;
  const passed = !result.error && exitCode === expectedExit;
  steps.push({
    label,
    command,
    expectedExit,
    exitCode,
    passed,
    durationMs: Date.now() - started,
  });
  if (!passed) {
    failed = true;
    process.stderr.write(
      `[phase16a-mobile] FAIL: ${label} (expected ${expectedExit}, received ${exitCode})\n`,
    );
  }
}

const head =
  spawnSync("git rev-parse HEAD", { shell: true, encoding: "utf8" }).stdout?.trim() ||
  "unknown";
run("immutable commit exists", `git cat-file -e ${head}`);
run("clean source state", "node scripts/verify-clean-worktree.mjs");
run("root/mobile package and lock integrity", "npm ci --dry-run --ignore-scripts && npm ls --all");
run("Prisma format", "npx prisma format --check");
run("Prisma validate, generate and status", "npx prisma validate && npx prisma generate && npx prisma migrate status");
run("empty migration replay", "npm run verify:clean-migrations");
run("isolated backup and restore", "npm run verify:backup-restore");
run("root TypeScript", "npx tsc --noEmit");
run("root ESLint", "npm run lint");
run("all unit and integration tests", "npm test");
run("Next production build", "npm run build");
run("synthetic pilot boundaries and fixtures", "npm run pilot:test-boundaries && npm run pilot:verify && npm run pilot:imports:validate");
run("tracker conformance", "npm run tracker:conformance");
run("UAT catalogue", "npm run pilot:uat:validate");
run("UAT pack initialization", `npm run pilot:uat:execution:init -- ${uatPack}`);
run("UAT pack validation", `npm run pilot:uat:execution:validate -- ${uatPack}`);
run("mobile TypeScript", "npm run mobile:typecheck");
run("mobile ESLint", "npm run mobile:lint");
run("mobile focused tests", "npm run mobile:test");
run("mobile fail-closed configuration", "npm run mobile:config:validate");
run("mobile release bundle", "npm run mobile:export");
run("web and mobile Playwright", "npx playwright test");
run("secret and environment scan", "npm run security:scan");
run("dependency audit", "npm audit --audit-level=low");
run("production readiness remains blocked", "npm run production:check", 1);
run("staging readiness remains blocked", "npm run staging:check", 1);
run("pilot performance regression", "npm run performance:pilot");
run("container non-root and liveness", "npm run pilot:docker:smoke");
run(
  "mobile release documents exist",
  "node -e \"const f=require('fs');['MOBILE_APPLICATION_ARCHITECTURE.md','MOBILE_SECURITY_AND_PRIVACY.md','MOBILE_TESTING.md','MOBILE_RELEASE_CHECKLIST.md','MOBILE_SECURITY_GUARD_GUIDE.md','MOBILE_OWNER_GUIDE.md','PHASE16A_MOBILE_READINESS_REPORT.md'].forEach(p=>{if(!f.existsSync(p))process.exit(1)})\"",
);
run("final clean source state", "node scripts/verify-clean-worktree.mjs");

if (fs.existsSync(uatPack)) fs.unlinkSync(uatPack);
const summary = {
  status: failed ? "FAIL" : "PASS",
  localOnly: true,
  deployed: false,
  published: false,
  nativeDeviceTested: false,
  externalConnections: false,
  productionReadinessExpectedBlocked: true,
  stagingReadinessExpectedBlocked: true,
  head,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  steps,
  notice:
    "Local browser/build engineering evidence; not native-device, business, legal, privacy, security, staging, store or production approval.",
};
const evidencePath = path.resolve(".data", "phase16a-mobile-release-evidence.json");
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(
  `\n[phase16a-mobile] ${summary.status}; ignored local evidence written. No deployment or publication was attempted.\n`,
);
process.exitCode = failed ? 1 : 0;
