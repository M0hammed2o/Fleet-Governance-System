// Phase 8A engineering hardening: proves that every committed migration
// applies cleanly, in order, to a genuinely empty PostgreSQL database — no
// manual checksum edits, no assumptions carried over from the dev/test
// databases' own migration history. Run this whenever migrations change,
// and as part of `npm run verify:phase` before any phase is reported done.
//
// Uses the same local Postgres container as dev/test (docker-compose.yml) —
// a throwaway database is created, migrated, and always dropped again
// afterward (success or failure), so this never leaves stray state behind
// in the shared container.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import { config } from "dotenv";

config({ path: ".env" });

const CONTAINER = "gate-fleet-governance-postgres";
const VERIFY_DB = "gate_fleet_governance_migration_check";
const WINDOWS_DOCKER = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const dockerExecutable = process.platform === "win32" && fs.existsSync(WINDOWS_DOCKER) ? WINDOWS_DOCKER : "docker";

if (!process.env.DATABASE_URL) {
  console.error("[verify-clean-migrations] DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}
const devUrl = new URL(process.env.DATABASE_URL);
const SUPERUSER = decodeURIComponent(devUrl.username);
const PASSWORD = decodeURIComponent(devUrl.password);
const HOST_PORT = devUrl.port || "5432";

function psql(sql) {
  execFileSync(dockerExecutable, ["exec", CONTAINER, "psql", "-U", SUPERUSER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit" });
}

function dropVerifyDb() {
  // Terminate any lingering connections first — Postgres refuses DROP DATABASE while sessions are attached.
  execFileSync(dockerExecutable, [
    "exec", CONTAINER, "psql", "-U", SUPERUSER, "-d", "postgres", "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${VERIFY_DB}' AND pid <> pg_backend_pid();`,
  ], { stdio: "ignore" });
  psql(`DROP DATABASE IF EXISTS ${VERIFY_DB};`);
}

console.log(`[verify-clean-migrations] Creating a genuinely empty database (${VERIFY_DB})...`);
dropVerifyDb();
psql(`CREATE DATABASE ${VERIFY_DB};`);

const verifyDatabaseUrl = `postgresql://${encodeURIComponent(SUPERUSER)}:${encodeURIComponent(PASSWORD)}@localhost:${HOST_PORT}/${VERIFY_DB}`;

let exitCode = 0;
try {
  console.log("[verify-clean-migrations] Applying every committed migration from zero (prisma migrate deploy)...");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: verifyDatabaseUrl },
  });
  console.log("[verify-clean-migrations] PASS — every migration applied cleanly to an empty database, no manual checksum changes.");
} catch (err) {
  exitCode = 1;
  console.error("[verify-clean-migrations] FAIL — a migration did not apply cleanly to a genuinely empty database.");
  console.error(err instanceof Error ? err.message : err);
} finally {
  console.log(`[verify-clean-migrations] Dropping the throwaway database (${VERIFY_DB})...`);
  dropVerifyDb();
}

process.exit(exitCode);
