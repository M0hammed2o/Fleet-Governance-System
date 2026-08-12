import { spawnSync } from "node:child_process";

function run(commandLine, env = process.env) {
  const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", commandLine] : ["-c", commandLine];
  const result = spawnSync(shell, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm run seed", { ...process.env, SEED_SUPPRESS_CREDENTIAL_OUTPUT: "true" });
if (process.argv[2] === "boundaries") run("npx tsx scripts/verify-pilot-boundaries.ts");
else run("npx tsx prisma/pilot-seed.ts seed");
