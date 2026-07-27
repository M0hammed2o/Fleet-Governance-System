import { test, expect } from "@playwright/test";

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
 */

const DEV_PASSWORD = "GateFleet!Dev1";
const TENANT_SLUG = "acme-logistics";

// Chromium flags for a synthetic camera/mic device and auto-accepted
// getUserMedia prompts — lets this test acquire a real MediaStream in a
// headless CI-like environment without real camera hardware.
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("VideoCaptureRecorder acquires a real (fake-device) camera stream and reaches the ready-to-record state", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByLabel("Company").fill(TENANT_SLUG);
  await page.getByLabel("Email").fill("gate.security.officer@example.test");
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");

  const eventsRes = await page.request.get("/api/gate/gate-events");
  const { items: gateEvents } = await eventsRes.json();
  test.skip(!gateEvents || gateEvents.length === 0, "No seeded gate events to attach evidence to.");

  await page.goto(`/gate/events/${gateEvents[0].id}`);

  const recordButton = page.getByRole("button", { name: "Record video" }).first();
  test.skip((await recordButton.count()) === 0, "This gate event is not in VEHICLE_CHECKS_IN_PROGRESS, where inspection-item evidence capture renders.");

  await recordButton.click();
  await page.getByRole("button", { name: "Start camera" }).click();

  // Reaching "ready" (the "Start recording" button appearing) proves
  // getUserMedia actually resolved with a live MediaStream from the fake
  // camera device, not just that the click handler ran.
  await expect(page.getByRole("button", { name: /start recording/i })).toBeVisible({ timeout: 10_000 });
});
