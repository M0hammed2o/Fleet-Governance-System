import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const startedAt = new Date();
const runId = process.env.PHASE17A_GATE_RUN?.trim() || "manual";
const steps = [];
let failed = false;
const nativeEnv = {
  ...process.env,
  ANDROID_HOME: process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"),
  MOBILE_APP_ID: "za.co.genbridge.fleet",
  MOBILE_NATIVE_ENV: "local",
  SEED_SUPPRESS_CREDENTIAL_OUTPUT: "true",
};

function run(label, command, expectedExit = 0) {
  const started = Date.now();
  process.stdout.write(`\n[phase17a:${runId}] ${label}\n`);
  const result = spawnSync(command, { shell: true, stdio: "inherit", env: nativeEnv });
  const exitCode = result.status ?? 1;
  const passed = !result.error && exitCode === expectedExit;
  steps.push({ label, command, expectedExit, exitCode, passed, durationMs: Date.now() - started });
  if (!passed) {
    failed = true;
    process.stderr.write(`[phase17a:${runId}] FAIL: ${label} expected ${expectedExit}, received ${exitCode}.\n`);
  }
}

const head = spawnSync("git rev-parse HEAD", { shell: true, encoding: "utf8" }).stdout?.trim() || "unknown";
run("clean immutable candidate", "node scripts/verify-clean-worktree.mjs");
run("package and lock integrity", "npm ci --dry-run --ignore-scripts && npm ls --all");
run("Prisma format", "npx prisma format --check");
run("Prisma validate and generate", "npx prisma validate && npx prisma generate");
run("Prisma migration status", "npx prisma migrate status");
run("empty database migration replay", "npm run verify:clean-migrations");
run("isolated local backup and restore", "npm run verify:backup-restore");
run("TypeScript", "npx tsc --noEmit");
run("ESLint", "npm run lint");
run("full Vitest regression", "npm test");
run("facial contracts and biometric lifecycle", "npx vitest run tests/facial-verification-contracts.test.ts tests/biometric-lifecycle.test.ts tests/facial-enrolment-repository.test.ts tests/facial-verification-attempt.test.ts tests/facial-verification.test.ts");
run("structured log redaction", "npx vitest run tests/production-readiness.test.ts tests/security-operations-hardening.test.ts");
run("production build", "npm run build");
run("fresh synthetic browser fixtures", "npm run seed && npm run demo:reset");
run("Playwright workflows", "npx playwright test");
run("pilot reset seed idempotency and tenant boundaries", "npm run pilot:test-boundaries && npm run pilot:verify");
run("pilot import validation", "npm run pilot:imports:validate");
run("tracker contract conformance", "npm run tracker:conformance");
run("existing UAT catalogue validation", "npm run pilot:uat:validate");
run("42-case internal rehearsal validation", "npm run pilot:rehearsal");
run("production facial activation remains blocked", "npm run facial:readiness", 1);
run("internal customer-handover readiness remains blocked", "npm run pilot:readiness", 1);
run("production readiness remains blocked", "npm run production:check", 1);
run("staging readiness remains blocked", "npm run staging:check", 1);
run("secret scan", "npm run security:scan");
run("repository backup hygiene", "npm run backup:readiness");
run("dependency audit", "npm audit --audit-level=moderate");
run("mobile TypeScript", "npm run mobile:typecheck");
run("mobile lint", "npm run mobile:lint");
run("mobile tests", "npm run mobile:test");
run("mobile configuration", "npm run mobile:config:validate");
run("Capacitor Android synchronization", "npm run android:sync");
run("Android configuration", "npm run android:config:validate");
run("Android JVM tests", "npm run android:test");
run("Android lint", "npm run android:lint");
run("debug APK build", "npm run android:build:debug");
run("pilot performance", "npm run performance:pilot");
run("Docker build and health smoke", "npm run pilot:docker:smoke");

const apkRelative = path.join("apps", "mobile", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const apkPath = path.resolve(apkRelative);
let apk = null;
if (fs.existsSync(apkPath)) {
  const contents = fs.readFileSync(apkPath);
  apk = { path: apkRelative.replaceAll("\\", "/"), bytes: contents.length, sha256: crypto.createHash("sha256").update(contents).digest("hex").toUpperCase() };
  const ignored = spawnSync("git", ["check-ignore", "-q", apkRelative]).status === 0;
  steps.push({ label: "debug APK evidence", passed: ignored, ignored, ...apk });
  if (!ignored) failed = true;
} else {
  failed = true;
  steps.push({ label: "debug APK evidence", passed: false, reason: "APK missing" });
}

const adb = path.join(nativeEnv.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
let deviceInventory = "ADB unavailable";
let deviceSmokeTested = false;
if (fs.existsSync(adb)) {
  const inventory = spawnSync(adb, ["devices", "-l"], { encoding: "utf8", env: nativeEnv });
  deviceInventory = inventory.stdout?.trim() || inventory.stderr?.trim() || "no devices";
  const online = /^\S+\s+device\b/m.test(inventory.stdout ?? "");
  if (online && apk) {
    const install = spawnSync(adb, ["install", "-r", "-t", apkPath], { encoding: "utf8", env: nativeEnv });
    const launch = install.status === 0 ? spawnSync(adb, ["shell", "monkey", "-p", "za.co.genbridge.fleet", "-c", "android.intent.category.LAUNCHER", "1"], { encoding: "utf8", env: nativeEnv }) : null;
    deviceSmokeTested = install.status === 0 && launch?.status === 0;
    steps.push({ label: "online Android device install and launch", passed: deviceSmokeTested, installExit: install.status, launchExit: launch?.status ?? null });
    if (!deviceSmokeTested) failed = true;
  } else {
    steps.push({ label: "online Android device install and launch", passed: true, skipped: true, reason: "No stable online ADB device; physical-device readiness remains blocked." });
  }
}

run("final Git diff and clean state", "git diff --check && git diff --cached --check && node scripts/verify-clean-worktree.mjs");
const summary = {
  status: failed ? "FAIL" : "PASS",
  runId,
  head,
  localOnly: true,
  deployed: false,
  published: false,
  externalConnectionsCreated: false,
  productionReadinessExpectedBlocked: true,
  stagingReadinessExpectedBlocked: true,
  facialActivationExpectedBlocked: true,
  internalHandoverExpectedBlocked: true,
  deviceSmokeTested,
  deviceInventory,
  apk,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  steps,
};
const evidencePath = path.resolve(".data", `phase17a-final-gate-${runId}.json`);
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`\n[phase17a:${runId}] ${summary.status}; ignored local evidence written to ${evidencePath}.\n`);
process.exitCode = failed ? 1 : 0;
