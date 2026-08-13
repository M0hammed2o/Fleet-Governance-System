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
    testTimeout: 30000,
    // Bound worker concurrency so full-gate database scans and per-file
    // tenant cleanup do not starve unrelated repository tests on local CI.
    // Tests within a tenant-isolation fixture still run serially per file.
    fileParallelism: true,
    maxWorkers: 4,
  },
});
