import { test, expect } from "@playwright/test";

/**
 * Phase 9C/9D/9E verification — a real (headless Chromium, fake-camera-
 * device) browser smoke test proving the actual model-loading and
 * per-frame detection pipeline works end to end in a live browser: the
 * MediaPipe WASM runtime and FaceLandmarker `.task` model genuinely fetch
 * from Google's CDN and initialize, the face-api.js face-recognition model
 * genuinely fetches from this app's own `/models/face-recognition` static
 * assets, and the requestAnimationFrame detection loop runs without
 * throwing.
 *
 * Chromium's `--use-fake-device-for-media-stream` produces a synthetic
 * moving test pattern, not an actual face — so this test cannot exercise a
 * real face-detected capture or a real MATCH/NO_MATCH outcome (the
 * server-side matching logic that decision actually depends on has full,
 * deterministic unit and integration coverage instead —
 * tests/facial-descriptor-math.test.ts, tests/facial-verification-attempt.test.ts).
 * This test's job is narrower and complementary: prove the real-browser
 * camera-and-model-loading half of the pipeline genuinely works, the same
 * role e2e/video-capture-smoke.spec.ts plays for video capture.
 */

const DEV_PASSWORD = "GateFleet!Dev1";
const TENANT_SLUG = "acme-logistics";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("DriverFacialEnrolmentCapture loads both models and runs its detection loop against a fake camera without error", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/login");
  await page.getByLabel("Company").fill(TENANT_SLUG);
  await page.getByLabel("Email").fill("company.administrator@example.test");
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");

  const driversRes = await page.request.get("/api/drivers");
  const { items: drivers } = await driversRes.json();
  test.skip(!drivers || drivers.length === 0, "No seeded drivers to enrol.");

  await page.goto(`/admin/drivers/${drivers[0].id}`);
  await expect(page.getByRole("heading", { name: "Biometric enrolment" })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /enrol driver|re-enrol/i }).click();
  await page.getByRole("checkbox", { name: /notice has been shown/i }).check();
  await page.getByRole("checkbox", { name: /selected driver, tenant, authority/i }).check();
  await page.getByRole("button", { name: /start local camera capture/i }).click();

  // The video element becoming visible proves getUserMedia resolved with a
  // live stream; waiting past that lets the detection loop run several
  // real frames through both loaded models before we assert on state.
  await expect(page.locator("video")).toBeVisible({ timeout: 10_000 });

  // No face in the synthetic test pattern, so the quality checklist should
  // report NO_FACE — proving detectFaceFrame() actually ran real MediaPipe
  // inference against real frames, not just that the camera opened. Generous
  // timeout: first-frame WASM/XNNPACK delegate warm-up is genuinely slow.
  await expect(page.getByText(/no face/i)).toBeVisible({ timeout: 20_000 });

  expect(consoleErrors).toEqual([]);
});
