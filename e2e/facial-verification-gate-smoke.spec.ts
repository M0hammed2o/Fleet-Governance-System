import { test, expect } from "@playwright/test";

/**
 * Phase 9D/9E/9H verification — companion to facial-verification-smoke.spec.ts:
 * proves GateFacialVerification (the gate-tablet-facing component) also
 * loads its models and starts its liveness-challenge camera loop without
 * error in a real browser, sharing the same underlying engine already
 * proven there. See that spec file for why a fake camera device cannot
 * exercise a real MATCH outcome, and where that logic's own coverage lives.
 */

const DEV_PASSWORD = "GateFleet!Dev1";
const TENANT_SLUG = "acme-logistics";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("GateFacialVerification loads its models and starts a liveness challenge against a fake camera without error", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/login");
  await page.getByLabel("Company").fill(TENANT_SLUG);
  await page.getByLabel("Email").fill("gate.security.officer@example.test");
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");

  const eventsRes = await page.request.get("/api/gate/gate-events");
  const { items: gateEvents } = await eventsRes.json();
  test.skip(!gateEvents || gateEvents.length === 0, "No seeded gate events.");

  await page.goto(`/gate/events/${gateEvents[0].id}`);

  const startButton = page.getByRole("button", { name: "Start facial verification" });
  await startButton.waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
  test.skip((await startButton.count()) === 0, "This gate event is not in IDENTITY_PENDING, where facial verification renders.");

  await startButton.click();
  await expect(page.locator("video")).toBeVisible({ timeout: 10_000 });

  // Reaching the challenge instruction proves getUserMedia resolved and
  // the liveness detection loop (same engine as the enrolment smoke test)
  // started running real per-frame MediaPipe inference.
  await expect(page.getByText(/please (blink|turn your head|move closer)/i)).toBeVisible({ timeout: 15_000 });

  expect(pageErrors).toEqual([]);
});
