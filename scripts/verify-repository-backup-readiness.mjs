import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenExtension = /\.(apk|aab|db|sqlite3?|dump|bak|backup|jks|keystore|p12|pfx|pem|key)$/i;
const forbiddenDirectory = /(^|\/)(\.data|artifacts|backups?|screenshots?|playwright-report|test-results)(\/|$)/i;
const forbiddenTracked = tracked.filter((file) => forbiddenExtension.test(file) || forbiddenDirectory.test(file));
const largeTracked = tracked.flatMap((file) => {
  const size = fs.statSync(file).size;
  return size > 10 * 1024 * 1024 ? [{ file, bytes: size }] : [];
});
const secretScan = spawnSync(process.execPath, ["scripts/verify-no-secrets.mjs"], { encoding: "utf8" });
const remotes = execFileSync("git", ["remote", "-v"], { encoding: "utf8" }).trim();
const structuralReady = forbiddenTracked.length === 0 && largeTracked.length === 0 && secretScan.status === 0;
const report = {
  status: structuralReady ? (remotes ? "READY" : "PASS_WITH_CRITICAL_OPERATIONAL_RISK") : "FAIL",
  structuralReady,
  privateRemoteConfigured: remotes.length > 0,
  operationalRisk: remotes ? null : "CRITICAL: no private remote backup is configured. This is an operational continuity risk, not a software defect.",
  trackedFilesInspected: tracked.length,
  forbiddenTracked,
  largeTracked,
  secretScanPassed: secretScan.status === 0,
  remoteVerificationCommand: "git remote -v",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (secretScan.stderr) process.stderr.write(secretScan.stderr);
process.exitCode = structuralReady ? 0 : 1;
