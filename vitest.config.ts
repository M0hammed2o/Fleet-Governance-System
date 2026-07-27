import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test" });

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(dirname, "./tests/mocks/server-only-noop.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Phase 8E-007 — deletes every tenant a test file created via
    // createTenant() once that file's tests finish, so repeated full runs
    // don't keep growing the test database. Runs once per file (its own
    // module instance), not once globally — see the file's own docstring.
    setupFiles: ["./tests/setup/global-cleanup.ts"],
    testTimeout: 15000,
    // Integration tests share one Postgres connection pool per file; running
    // files in parallel workers is fine, but tests within a tenant-isolation
    // fixture must not race each other, so each file runs its cases serially.
    fileParallelism: true,
  },
});
