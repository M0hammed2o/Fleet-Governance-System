export interface LocalDatabaseTarget {
  host: string;
  port: string;
  database: string;
  username: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SAFE_DATABASE_SUFFIXES = ["_test", "_migration_check", "_restore_verify"];

export function validateLocalDatabaseTarget(rawUrl: string | undefined):
  | { safe: true; target: LocalDatabaseTarget }
  | { safe: false; reason: string } {
  if (!rawUrl) return { safe: false, reason: "a database URL must be supplied explicitly" };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "the database URL is invalid" };
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { safe: false, reason: "only PostgreSQL targets are supported" };
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    return { safe: false, reason: "backup verification is restricted to loopback hosts" };
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || !SAFE_DATABASE_SUFFIXES.some((suffix) => database.endsWith(suffix))) {
    return { safe: false, reason: "database name must end in _test, _migration_check, or _restore_verify" };
  }
  if (!url.username) return { safe: false, reason: "the database URL must include a username" };

  return {
    safe: true,
    target: {
      host: url.hostname,
      port: url.port || "5432",
      database,
      username: decodeURIComponent(url.username),
    },
  };
}

export function assertDistinctRestoreTarget(source: LocalDatabaseTarget, restore: LocalDatabaseTarget): void {
  if (source.host === restore.host && source.port === restore.port && source.database === restore.database) {
    throw new Error("Restore verification target must be different from the backup source.");
  }
  if (!restore.database.endsWith("_restore_verify")) {
    throw new Error("Restore verification database must end in _restore_verify.");
  }
}
