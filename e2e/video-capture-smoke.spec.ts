import { test, expect } from "@playwright/test";
import { loginAllRoles, createDedicatedGateEventAtIdentityPending, advanceToVehicleChecksInProgress } from "./helpers/gate-fixtures";

/**
 * Phase 8E-006 verification — a real (headless Chromium, fake-camera-device)
 * browser smoke test of VideoCaptureRecorder's getUserMedia integration.
 * This proves camera-permission handling and stream attachment genuinely
 * work end to end in a real browser, not just that the component compiles.
 * This exact test caught a real bug during verification: a hard `frameRate:
 * { min }` constraint (rather than `ideal`) threw OverconstrainedError and
 * refused to open the camera at all against Chromium's fake device — fixed
 * in video-capture-recorder.tsx.
 *
 * Deliberately does NOT exercise a full record -> auto-stop -> upload round
 * trip (the shortest configurable policy is a 30s recording, and simulating
 * MediaRecorder producing real encoded chunks from a fake video device is
 * beyond a reasonable smoke-test budget here) — that path's *policy logic*
 * (duration/size limits, mime-type selection, honest metadata) has full,
 * deterministic unit coverage instead (tests/video-capture-policy.test.ts).
 * This test's job is narrower and complementary: prove the real-browser
 * camera-acquisition half of the flow actually works.
 *
 * P9F-002: builds its own dedicated gate event, driven all the way to
 * VEHICLE_CHECKS_IN_PROGRESS via real API calls (see
 * e2e/helpers/gate-fixtures.ts), instead of depending on a specific seeded
 * gate event's status — no `test.skip()` fallback for a missing
 * precondition, because the precondition is now guaranteed by construction.
 */

// Chromium flags for a synthetic camera/mic device and auto-accepted
// getUserMedia prompts — lets this test acquire a real MediaStream in a
// headless CI-like environment without real camera hardware.
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("VideoCaptureRecorder acquires a real (fake-device) camera stream and reaches the ready-to-record state", async ({ browser }) => {
  const roles = await loginAllRoles(browser, { permissions: ["camera", "microphone"] });
  const fixture = await createDedicatedGateEventAtIdentityPending(roles, 800);
  await advanceToVehicleChecksInProgress(roles.officerPage, fixture);

  await roles.officerPage.goto(`/gate/events/${fixture.gateEventId}`);

  const recordButton = roles.officerPage.getByRole("button", { name: "Record video" }).first();
  await expect(recordButton).toBeVisible({ timeout: 15_000 });

  await recordButton.click();
  await roles.officerPage.getByRole("button", { name: "Start camera" }).click();

  // Reaching "ready" (the "Start recording" button appearing) proves
  // getUserMedia actually resolved with a live MediaStream from the fake
  // camera device, not just that the click handler ran.
  await expect(roles.officerPage.getByRole("button", { name: /start recording/i })).toBeVisible({ timeout: 10_000 });

  for (const context of roles.contexts) await context.close();
});
