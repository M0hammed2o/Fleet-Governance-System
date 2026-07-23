import { defineConfig, devices } from "@playwright/test";

// No e2e specs exist yet (Phase 1 has only login/dashboard). This config is
// wired now so `npm run e2e` works the moment Phase 3 gate-operations specs
// land — see TESTING.md "End-to-end tests".
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
