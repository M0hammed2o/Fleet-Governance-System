import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const image = "genbridge-governance:phase15a-local";
const container = "genbridge-phase15a-smoke";
let created = false;
const windowsDocker = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const dockerExecutable = process.platform === "win32" && fs.existsSync(windowsDocker) ? windowsDocker : "docker";
const ephemeralSecret = () => crypto.randomBytes(32).toString("base64url");
const smokeRuntimeConfiguration = {
  APP_ENV: "production",
  APP_BASE_URL: "https://container-smoke.invalid",
  DATABASE_URL: "postgresql://smoke:unused@database.invalid:5432/governance_smoke?sslmode=require",
  DIRECT_DATABASE_URL: "postgresql://smoke:unused@database.invalid:5432/governance_smoke?sslmode=require",
  DATABASE_SSL_MODE: "require",
  SESSION_SECRET: ephemeralSecret(),
  MEDIA_URL_SIGNING_SECRET: ephemeralSecret(),
  BIOMETRIC_TEMPLATE_ENCRYPTION_KEY: ephemeralSecret(),
  JOB_SCHEDULER_TOKEN: ephemeralSecret(),
  STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "container-smoke-inert",
  R2_ACCESS_KEY_ID: ephemeralSecret(),
  R2_SECRET_ACCESS_KEY: ephemeralSecret(),
  R2_BUCKET_NAME: "container-smoke-inert",
};
const smokeEnvironment = { ...process.env, ...smokeRuntimeConfiguration };
const smokeEnvironmentNames = Object.keys(smokeRuntimeConfiguration);

function docker(args, stdio = "inherit") {
  return spawnSync(dockerExecutable, args, { stdio, encoding: stdio === "pipe" ? "utf8" : undefined, env: smokeEnvironment });
}

function requireSuccess(label, result) {
  if (result.error || result.status !== 0) throw new Error(`${label} failed with exit ${result.status ?? "unknown"}.`);
}

async function main() {
  const existing = docker(["container", "inspect", container], "ignore");
  if (existing.status === 0) throw new Error(`Refusing to replace existing container ${container}. Remove or rename it deliberately first.`);

  requireSuccess("container image build", docker(["build", "--tag", image, "."]));
  const environmentArguments = smokeEnvironmentNames.flatMap((name) => ["--env", name]);
  requireSuccess("container start", docker(["run", "--detach", "--name", container, "--publish", "127.0.0.1:3100:3000", ...environmentArguments, image]));
  created = true;

  const configuredUser = docker(["image", "inspect", "--format", "{{.Config.User}}", image], "pipe");
  requireSuccess("container user inspection", configuredUser);
  if (!/^nextjs$|^1001$/.test(configuredUser.stdout.trim())) throw new Error("Runtime image is not configured for the expected non-root user.");

  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3100/api/health/live");
      const body = await response.json();
      if (response.ok && body.status === "ok") { healthy = true; break; }
    } catch {
      // Startup connection failures are expected within this bounded poll.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!healthy) throw new Error("Container did not return the expected liveness response within 60 seconds.");
  process.stdout.write(`${JSON.stringify({ status: "PASS", image, runtimeUser: configuredUser.stdout.trim(), liveness: { status: "ok" }, productionDataConnected: false }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Container smoke test failed."}\n`);
  process.exitCode = 1;
}).finally(() => {
  if (created) docker(["rm", "--force", container], "ignore");
});
