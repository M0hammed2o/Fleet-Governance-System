/**
 * Pure, DB-free, browser-free basic on-device liveness logic (Phase 9E).
 * The caller (components/liveness-challenge.tsx) feeds this module a
 * stream of per-frame landmark/blendshape signals computed by MediaPipe's
 * FaceLandmarker (FACIAL_VERIFICATION_LICENSING.md section 1) — this
 * module never touches the camera, a DOM element, or MediaPipe itself, so
 * it is fully unit-testable without a real browser.
 *
 * Documented limitation (must be surfaced to the security officer, not
 * hidden): this is basic landmark-geometry liveness — it is not a
 * specialised commercial anti-spoofing product (no depth sensing, no
 * infrared, no trained spoof-detection model). It raises the bar against a
 * single printed photo or a static image held up to the camera; it is not
 * proof against a sufficiently determined attacker (e.g. a video replay of
 * a blinking face). The security officer physically present at the gate
 * remains responsible for observing the person — this challenge is a
 * supporting check, never a replacement for that.
 */

export type LivenessChallengeType = "BLINK" | "TURN_LEFT" | "TURN_RIGHT" | "MOVE_CLOSER";

export const LIVENESS_CHALLENGE_TYPES: readonly LivenessChallengeType[] = ["BLINK", "TURN_LEFT", "TURN_RIGHT", "MOVE_CLOSER"];

/** Randomised so a pre-recorded loop matching one specific challenge can't be prepared in advance. */
export function pickRandomChallenge(random: () => number = Math.random): LivenessChallengeType {
  const index = Math.min(Math.floor(random() * LIVENESS_CHALLENGE_TYPES.length), LIVENESS_CHALLENGE_TYPES.length - 1);
  return LIVENESS_CHALLENGE_TYPES[index];
}

export interface LivenessPolicy {
  timeLimitSeconds: number;
  maxRetries: number;
  /** A single frame (i.e. a still photo) can never complete a challenge — this many frames of genuine signal variance are required first. */
  minContinuousFrames: number;
}

export const DEFAULT_LIVENESS_POLICY: LivenessPolicy = {
  timeLimitSeconds: 10,
  maxRetries: 2,
  minContinuousFrames: 5,
};

export interface LivenessFrameSignal {
  /** MediaPipe FaceLandmarker blendshape scores, 0-1. */
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  /** Derived head yaw, degrees — negative = turned left, positive = turned right, from the caller's own landmark-geometry computation. */
  headYawDegrees: number;
  timestamp: number;
}

export type LivenessOutcome = "PASSED" | "FAILED_TIMEOUT" | "FAILED_NO_PROGRESS" | "FAILED_STATIC_INPUT";

export interface EvaluateLivenessInput {
  challenge: LivenessChallengeType;
  frames: LivenessFrameSignal[];
  policy?: LivenessPolicy;
  /** Face bounding-box area ratio (of frame area) per frame — only required for MOVE_CLOSER. */
  faceAreaRatios?: number[];
}

export interface LivenessEvaluationResult {
  outcome: LivenessOutcome;
  framesUsed: number;
}

const BLINK_CLOSED_THRESHOLD = 0.5;
const HEAD_TURN_THRESHOLD_DEGREES = 15;
const MOVE_CLOSER_MIN_AREA_GROWTH_RATIO = 1.15;
const STATIC_INPUT_VARIANCE_EPSILON = 1e-6;

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

/** A blink = eyes transition closed -> open at least once within the frame window, not merely "closed in one frame." */
function hasBlinkEvent(frames: LivenessFrameSignal[]): boolean {
  let wasClosed = false;
  for (const frame of frames) {
    const closed = frame.eyeBlinkLeft > BLINK_CLOSED_THRESHOLD && frame.eyeBlinkRight > BLINK_CLOSED_THRESHOLD;
    if (closed) {
      wasClosed = true;
    } else if (wasClosed) {
      return true; // closed, then open again — a completed blink
    }
  }
  return false;
}

export function evaluateLivenessChallenge(input: EvaluateLivenessInput): LivenessEvaluationResult {
  const policy = input.policy ?? DEFAULT_LIVENESS_POLICY;
  const frames = input.frames;

  if (frames.length < policy.minContinuousFrames) {
    return { outcome: "FAILED_NO_PROGRESS", framesUsed: frames.length };
  }

  const elapsedSeconds = (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000;
  if (elapsedSeconds > policy.timeLimitSeconds) {
    return { outcome: "FAILED_TIMEOUT", framesUsed: frames.length };
  }

  // A genuinely live camera feed shows *some* frame-to-frame variance in at
  // least one tracked signal; a static photo replayed frame after frame
  // shows none in any of them — this is what actually prevents a single
  // still image from completing any challenge, independent of which
  // specific challenge was asked for. faceAreaRatios is included here (not
  // just blink/yaw) so a MOVE_CLOSER challenge — which may legitimately
  // hold blink/yaw steady while only distance changes — isn't
  // misclassified as static input.
  const blinkSignal = frames.map((f) => f.eyeBlinkLeft + f.eyeBlinkRight);
  const yawSignal = frames.map((f) => f.headYawDegrees);
  const areaSignal = input.faceAreaRatios ?? [];
  const anySignalVaries =
    variance(blinkSignal) >= STATIC_INPUT_VARIANCE_EPSILON ||
    variance(yawSignal) >= STATIC_INPUT_VARIANCE_EPSILON ||
    variance(areaSignal) >= STATIC_INPUT_VARIANCE_EPSILON;
  if (!anySignalVaries) {
    return { outcome: "FAILED_STATIC_INPUT", framesUsed: frames.length };
  }

  switch (input.challenge) {
    case "BLINK":
      return { outcome: hasBlinkEvent(frames) ? "PASSED" : "FAILED_NO_PROGRESS", framesUsed: frames.length };
    case "TURN_LEFT":
      return { outcome: frames.some((f) => f.headYawDegrees <= -HEAD_TURN_THRESHOLD_DEGREES) ? "PASSED" : "FAILED_NO_PROGRESS", framesUsed: frames.length };
    case "TURN_RIGHT":
      return { outcome: frames.some((f) => f.headYawDegrees >= HEAD_TURN_THRESHOLD_DEGREES) ? "PASSED" : "FAILED_NO_PROGRESS", framesUsed: frames.length };
    case "MOVE_CLOSER": {
      const ratios = input.faceAreaRatios ?? [];
      if (ratios.length < 2) return { outcome: "FAILED_NO_PROGRESS", framesUsed: frames.length };
      const grew = ratios[ratios.length - 1] / ratios[0] >= MOVE_CLOSER_MIN_AREA_GROWTH_RATIO;
      return { outcome: grew ? "PASSED" : "FAILED_NO_PROGRESS", framesUsed: frames.length };
    }
  }
}

export interface LivenessAttemptTracker {
  attempts: number;
  maxRetries: number;
}

/** Repeated liveness failures escalate to a supervisor rather than retrying forever — see components/liveness-challenge.tsx. */
export function shouldEscalateAfterFailure(tracker: LivenessAttemptTracker): boolean {
  return tracker.attempts >= tracker.maxRetries;
}
