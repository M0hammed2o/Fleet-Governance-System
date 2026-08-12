import { spawnSync } from "node:child_process";

const image = "genbridge-governance:phase14a-local";
const container = "genbridge-phase14a-smoke";
let created = false;

function docker(args, stdio = "inherit") {
  return spawnSync("docker", args, { stdio, encoding: stdio === "pipe" ? "utf8" : undefined });
}

function requireSuccess(label, result) {
  if (result.error || result.status !== 0) throw new Error(`${label} failed with exit ${result.status ?? "unknown"}.`);
}

async function main() {
  const existing = docker(["container", "inspect", container], "ignore");
  if (existing.status === 0) throw new Error(`Refusing to replace existing container ${container}. Remove or rename it deliberately first.`);

  requireSuccess("container image build", docker(["build", "--tag", image, "."]));
  requireSuccess("container start", docker(["run", "--detach", "--name", container, "--publish", "127.0.0.1:3100:3000", image]));
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
