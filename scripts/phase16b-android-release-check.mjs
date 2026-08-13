import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const startedAt = new Date();
const steps = [];
let failed = false;
const root = process.cwd();
const androidSdk =
  process.env.ANDROID_HOME ??
  path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const adb = path.join(
  androidSdk,
  "platform-tools",
  process.platform === "win32" ? "adb.exe" : "adb",
);
const nativeEnv = {
  ...process.env,
  ANDROID_HOME: androidSdk,
  MOBILE_APP_ID: "za.co.genbridge.fleet",
  MOBILE_NATIVE_ENV: "local",
  SEED_SUPPRESS_CREDENTIAL_OUTPUT: "true",
};

function run(label, command, expectedExit = 0) {
  const started = Date.now();
  process.stdout.write(`\n[phase16b-android] ${label}\n`);
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: nativeEnv,
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
      `[phase16b-android] FAIL: ${label} (expected ${expectedExit}, received ${exitCode})\n`,
    );
  }
}

const head =
  spawnSync("git rev-parse HEAD", {
    shell: true,
    encoding: "utf8",
  }).stdout?.trim() ?? "unknown";

run("clean immutable candidate", "node scripts/verify-clean-worktree.mjs");
run("complete Phase 16A/root regression gate", "npm run mobile:rc");
run("Capacitor Android sync", "npm run android:sync");
run("Android source configuration", "npm run android:config:validate");
run(
  "Android JVM tests, lint and debug APK",
  "node scripts/run-android-gradle.mjs testDebugUnitTest lintDebug assembleDebug",
);
run(
  "release build rejects provisional local configuration",
  "node scripts/run-android-gradle.mjs :app:validateReleaseNativeConfig",
  1,
);

const apkRelative = path.join(
  "apps",
  "mobile",
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);
const apkPath = path.join(root, apkRelative);
let apk = null;
if (!fs.existsSync(apkPath)) {
  failed = true;
  steps.push({ label: "debug APK evidence", passed: false });
} else {
  const bytes = fs.readFileSync(apkPath);
  apk = {
    path: apkRelative.replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex")
      .toUpperCase(),
  };
  const ignored =
    spawnSync("git", ["check-ignore", "-q", apkRelative], {
      cwd: root,
    }).status === 0;
  steps.push({ label: "debug APK evidence", passed: ignored, ...apk, ignored });
  if (!ignored) failed = true;
  process.stdout.write(
    `[phase16b-android] APK ${apk.path} ${apk.bytes} bytes SHA-256 ${apk.sha256}; ignored=${ignored}\n`,
  );
}

let deviceAvailable = false;
let nativeDeviceTested = false;
let deviceInventory = "adb unavailable";
if (fs.existsSync(adb)) {
  const result = spawnSync(adb, ["devices", "-l"], {
    env: nativeEnv,
    encoding: "utf8",
  });
  deviceInventory =
    result.stdout?.trim() || result.stderr?.trim() || "no devices";
  deviceAvailable = /^\S+\s+device\b/m.test(result.stdout ?? "");
  process.stdout.write(
    `\n[phase16b-android] device inventory\n${deviceInventory}\n`,
  );
  if (deviceAvailable) {
    run(
      "connected Android instrumentation",
      "node scripts/run-android-gradle.mjs connectedDebugAndroidTest",
    );
    nativeDeviceTested = !failed;
  } else {
    steps.push({
      label: "connected Android instrumentation",
      passed: true,
      skipped: true,
      reason: "No online ADB device; ANDROID-ENV-001 remains documented.",
    });
  }
}

run(
  "Phase 16B documents exist",
  "node -e \"const f=require('fs');['ANDROID_NATIVE_ARCHITECTURE.md','ANDROID_DEVELOPMENT_SETUP.md','ANDROID_DEVICE_TESTING_GUIDE.md','ANDROID_SECURITY_REVIEW.md','ANDROID_TEST_EXECUTION_REPORT.md','PHASE16B_ANDROID_READINESS_REPORT.md'].forEach(p=>{if(!f.existsSync(p))process.exit(1)})\"",
);
run("final clean source state", "node scripts/verify-clean-worktree.mjs");

const summary = {
  status: failed ? "FAIL" : "PASS",
  localOnly: true,
  deployed: false,
  published: false,
  signedForDistribution: false,
  deviceAvailable,
  nativeDeviceTested,
  deviceInventory,
  knownDeviceBlocker: nativeDeviceTested ? null : "ANDROID-ENV-001",
  head,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  apk,
  steps,
  notice:
    "A passing gate establishes local Android project/debug-build readiness only. Device and release readiness remain blocked unless nativeDeviceTested is true and manual approvals are complete.",
};
const evidencePath = path.resolve(
  ".data",
  "phase16b-android-release-evidence.json",
);
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(
  `\n[phase16b-android] ${summary.status}; ignored local evidence written. No deployment, signing or publication was attempted.\n`,
);
process.exitCode = failed ? 1 : 0;
