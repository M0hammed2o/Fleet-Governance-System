import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { assertDistinctRestoreTarget, validateLocalDatabaseTarget } from "../src/lib/db/database-safety";

config({ path: ".env.test" });

const container = "gate-fleet-governance-postgres";
const windowsDocker = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const dockerExecutable = process.platform === "win32" && existsSync(windowsDocker) ? windowsDocker : "docker";
const sourceResult = validateLocalDatabaseTarget(process.env.DATABASE_URL);
if (!sourceResult.safe) throw new Error(`Backup source refused: ${sourceResult.reason}. No database was changed.`);

const source = sourceResult.target;
const restoreName = "gate_fleet_governance_restore_verify";
const restoreUrl = new URL(process.env.DATABASE_URL!);
restoreUrl.pathname = `/${restoreName}`;
const restoreResult = validateLocalDatabaseTarget(restoreUrl.toString());
if (!restoreResult.safe) throw new Error(`Restore target refused: ${restoreResult.reason}. No database was changed.`);
const restore = restoreResult.target;
assertDistinctRestoreTarget(source, restore);

function docker(args: string[], input?: Buffer): Buffer {
  const result = spawnSync(dockerExecutable, args, { input, encoding: null, maxBuffer: 1024 * 1024 * 512 });
  if (result.status !== 0) {
    const safeError = result.stderr?.toString("utf8").split("\n")[0] || "Docker command failed";
    throw new Error(safeError);
  }
  return result.stdout ?? Buffer.alloc(0);
}

function adminSql(sql: string): void {
  docker(["exec", container, "psql", "-U", source.username, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function dropRestoreDatabase(): void {
  adminSql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${restore.database}' AND pid <> pg_backend_pid();`);
  adminSql(`DROP DATABASE IF EXISTS ${restore.database};`);
}

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "genbridge-backup-verify-"));
const dumpPath = path.join(temporaryDirectory, "database.dump");
let succeeded = false;

try {
  console.log(`[backup-verify] Creating an ephemeral backup from validated local test database ${source.database}.`);
  const dump = docker(["exec", container, "pg_dump", "-U", source.username, "-d", source.database, "--format=plain", "--no-owner", "--no-acl"]);
  writeFileSync(dumpPath, dump);

  dropRestoreDatabase();
  adminSql(`CREATE DATABASE ${restore.database};`);
  docker(["exec", "-i", container, "psql", "-U", source.username, "-d", restore.database, "-v", "ON_ERROR_STOP=1"], readFileSync(dumpPath));

  const migrationCount = docker(["exec", container, "psql", "-U", source.username, "-d", restore.database, "-At", "-c", "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"])
    .toString("utf8")
    .trim();
  if (!/^\d+$/.test(migrationCount) || Number(migrationCount) < 1) throw new Error("Restored database did not contain a valid migration history.");

  succeeded = true;
  console.log(`[backup-verify] PASS - restore completed and ${migrationCount} applied migrations were verified.`);
} finally {
  try {
    dropRestoreDatabase();
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  if (!succeeded) console.error("[backup-verify] FAIL - the disposable restore database and local dump were cleaned up.");
}
