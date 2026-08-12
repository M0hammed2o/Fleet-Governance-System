import { defineConfig, devices } from "@playwright/test";

// Specs live under ./e2e — see TESTING.md "End-to-end tests" for the
// current list and what each one covers.
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // These are stateful integration workflows against one seeded database
  // and one Next dev server. Serial execution prevents cross-spec resource
  // starvation and data interference while preserving parallelism inside
  // the application itself.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // Phase 9I requirement: a failing spec's page state should be
    // inspectable afterward without needing to reproduce it live.
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
