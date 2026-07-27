import { test, expect } from "@playwright/test";
import { loginAllRoles, createDedicatedGateEventAtIdentityPending } from "./helpers/gate-fixtures";

/**
 * Phase 9D/9E/9H verification — companion to facial-verification-smoke.spec.ts:
 * proves GateFacialVerification (the gate-tablet-facing component) also
 * loads its models and starts its liveness-challenge camera loop without
 * error in a real browser, sharing the same underlying engine already
 * proven there. See that spec file for why a fake camera device cannot
 * exercise a real MATCH outcome, and where that logic's own coverage lives.
 *
 * P9F-002: each test below builds its own dedicated gate event via real API
 * calls (see e2e/helpers/gate-fixtures.ts) instead of depending on a
 * specific seeded gate event's status/ordering — no `test.skip()` fallback
 * for a missing precondition, because the precondition is now guaranteed by
 * construction.
 */

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("GateFacialVerification loads its models and starts a liveness challenge against a fake camera without error", async ({ browser }) => {
  const roles = await loginAllRoles(browser, { permissions: ["camera", "microphone"] });
  const fixture = await createDedicatedGateEventAtIdentityPending(roles, 700);

  const pageErrors: string[] = [];
  roles.officerPage.on("pageerror", (err) => pageErrors.push(err.message));

  await roles.officerPage.goto(`/gate/events/${fixture.gateEventId}`);

  const startButton = roles.officerPage.getByRole("button", { name: "Start facial verification" });
  await expect(startButton).toBeVisible({ timeout: 15_000 });

  await startButton.click();
  await expect(roles.officerPage.locator("video")).toBeVisible({ timeout: 10_000 });

  // Reaching the challenge instruction proves getUserMedia resolved and
  // the liveness detection loop (same engine as the enrolment smoke test)
  // started running real per-frame MediaPipe inference.
  await expect(roles.officerPage.getByText(/please (blink|turn your head|move closer)/i)).toBeVisible({ timeout: 15_000 });

  expect(pageErrors).toEqual([]);

  for (const context of roles.contexts) await context.close();
});

test("P9F-001: a provider-unavailable browser reports a safe, audited, never-successful outcome, not a silent local error", async ({ browser }) => {
  const roles = await loginAllRoles(browser);
  const fixture = await createDedicatedGateEventAtIdentityPending(roles, 701);

  // Simulate the on-device provider genuinely being unavailable (e.g. no
  // camera/media API present) deterministically, rather than fighting
  // Chromium's fake-device-permission flags — this exercises the exact
  // `!isFacialCaptureSupported()` branch in GateFacialVerification.
  await roles.officerPage.addInitScript(() => {
    Object.defineProperty(window.navigator, "mediaDevices", { get: () => undefined, configurable: true });
  });

  await roles.officerPage.goto(`/gate/events/${fixture.gateEventId}`);

  const startButton = roles.officerPage.getByRole("button", { name: "Start facial verification" });
  await expect(startButton).toBeVisible({ timeout: 15_000 });
  await startButton.click();

  // The page refreshes its gate-event data after every verification attempt
  // (the same pattern every gate action already uses), so the
  // safety-relevant assertion is on the settled state, not the component's
  // fleeting local "result" phase: the outcome is shown safely (no raw
  // confidence value or technical detail), never as a success, and a
  // retry/manual-fallback route remains available.
  await expect(roles.officerPage.getByText(/Last result:\s*PROVIDER_UNAVAILABLE/)).toBeVisible({ timeout: 15_000 });
  await expect(roles.officerPage.getByText("Verified", { exact: true })).toHaveCount(0);
  await expect(roles.officerPage.getByRole("button", { name: "Start facial verification" })).toBeVisible(); // retry route
  await expect(roles.officerPage.getByRole("button", { name: "Request manual fallback" })).toBeVisible(); // manual-fallback route
  await expect(roles.officerPage.getByText("IDENTITY PENDING")).toBeVisible(); // never silently advanced

  // The attempt was genuinely audited server-side, not just shown locally.
  const attemptsRes = await roles.adminPage.request.get(`/api/gate/gate-events/${fixture.gateEventId}/facial-verification`);
  expect(attemptsRes.ok()).toBe(true);
  const { attempts } = await attemptsRes.json();
  expect(attempts.length).toBeGreaterThanOrEqual(1);
  expect(attempts[0].result).toBe("PROVIDER_UNAVAILABLE");

  const gateEventRes = await roles.officerPage.request.get(`/api/gate/gate-events/${fixture.gateEventId}`);
  expect(gateEventRes.ok()).toBe(true);
  const { gateEvent } = await gateEventRes.json();
  expect(gateEvent.status).toBe("IDENTITY_PENDING");

  for (const context of roles.contexts) await context.close();
});
