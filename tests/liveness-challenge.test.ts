import { describe, it, expect } from "vitest";
import {
  pickRandomChallenge,
  evaluateLivenessChallenge,
  shouldEscalateAfterFailure,
  LIVENESS_CHALLENGE_TYPES,
  DEFAULT_LIVENESS_POLICY,
  type LivenessFrameSignal,
} from "@/lib/facial-verification/liveness-challenge";

function frame(overrides: Partial<LivenessFrameSignal>, timestamp: number): LivenessFrameSignal {
  return { eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05, headYawDegrees: 0, timestamp, ...overrides };
}

describe("Phase 9E: pickRandomChallenge", () => {
  it("only ever returns a value from the known challenge set", () => {
    for (let i = 0; i < 50; i++) {
      const challenge = pickRandomChallenge(() => Math.random());
      expect(LIVENESS_CHALLENGE_TYPES).toContain(challenge);
    }
  });

  it("is driven by the injected random source (deterministic for a fixed value)", () => {
    expect(pickRandomChallenge(() => 0)).toBe(LIVENESS_CHALLENGE_TYPES[0]);
    expect(pickRandomChallenge(() => 0.99)).toBe(LIVENESS_CHALLENGE_TYPES[LIVENESS_CHALLENGE_TYPES.length - 1]);
  });
});

describe("Phase 9E: evaluateLivenessChallenge", () => {
  it("BLINK passes when eyes transition closed -> open within the window", () => {
    const frames = [
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 0),
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 100),
      frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }, 200), // closed
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 300), // open again
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.06 }, 400),
    ];
    const result = evaluateLivenessChallenge({ challenge: "BLINK", frames });
    expect(result.outcome).toBe("PASSED");
  });

  it("BLINK fails when eyes never close", () => {
    const frames = [
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 0),
      frame({ eyeBlinkLeft: 0.08, eyeBlinkRight: 0.07 }, 100),
      frame({ eyeBlinkLeft: 0.06, eyeBlinkRight: 0.09 }, 200),
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 300),
      frame({ eyeBlinkLeft: 0.07, eyeBlinkRight: 0.06 }, 400),
    ];
    const result = evaluateLivenessChallenge({ challenge: "BLINK", frames });
    expect(result.outcome).toBe("FAILED_NO_PROGRESS");
  });

  it("TURN_LEFT passes when yaw goes far enough negative, TURN_RIGHT does not accept the same frames", () => {
    const frames = [
      frame({ headYawDegrees: 0 }, 0),
      frame({ headYawDegrees: -5 }, 100),
      frame({ headYawDegrees: -20 }, 200),
      frame({ headYawDegrees: -18 }, 300),
      frame({ headYawDegrees: -2 }, 400),
    ];
    expect(evaluateLivenessChallenge({ challenge: "TURN_LEFT", frames }).outcome).toBe("PASSED");
    expect(evaluateLivenessChallenge({ challenge: "TURN_RIGHT", frames }).outcome).toBe("FAILED_NO_PROGRESS");
  });

  it("MOVE_CLOSER passes when the face bounding-box area grows enough", () => {
    const frames = [frame({}, 0), frame({}, 100), frame({}, 200), frame({}, 300), frame({}, 400)];
    const growing = [0.05, 0.06, 0.07, 0.08, 0.1]; // ~2x growth
    expect(evaluateLivenessChallenge({ challenge: "MOVE_CLOSER", frames, faceAreaRatios: growing }).outcome).toBe("PASSED");

    // Some variance, but not enough growth to satisfy the challenge.
    const insufficientGrowth = [0.05, 0.052, 0.049, 0.051, 0.053];
    expect(evaluateLivenessChallenge({ challenge: "MOVE_CLOSER", frames, faceAreaRatios: insufficientGrowth }).outcome).toBe("FAILED_NO_PROGRESS");
  });

  it("MOVE_CLOSER with a genuinely flat area ratio and flat blink/yaw is classified as static input, not merely 'no progress'", () => {
    const frames = [frame({}, 0), frame({}, 100), frame({}, 200), frame({}, 300), frame({}, 400)];
    const flat = [0.05, 0.05, 0.05, 0.05, 0.05];
    expect(evaluateLivenessChallenge({ challenge: "MOVE_CLOSER", frames, faceAreaRatios: flat }).outcome).toBe("FAILED_STATIC_INPUT");
  });

  it("fails with FAILED_NO_PROGRESS when fewer frames than minContinuousFrames were captured (a single still photo cannot complete a challenge)", () => {
    const frames = [frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }, 0)];
    const result = evaluateLivenessChallenge({ challenge: "BLINK", frames });
    expect(result.outcome).toBe("FAILED_NO_PROGRESS");
  });

  it("fails with FAILED_STATIC_INPUT when every frame is identical (a replayed still photo), even with enough frames", () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9, headYawDegrees: 0 }, i * 100));
    const result = evaluateLivenessChallenge({ challenge: "BLINK", frames });
    expect(result.outcome).toBe("FAILED_STATIC_INPUT");
  });

  it("fails with FAILED_TIMEOUT when the frame window exceeds the policy's time limit", () => {
    const frames = [
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 0),
      frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }, 5000),
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 11000), // 11s later — exceeds the default 10s limit
      frame({ eyeBlinkLeft: 0.06, eyeBlinkRight: 0.05 }, 11500),
      frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.07 }, 12000),
    ];
    const result = evaluateLivenessChallenge({ challenge: "BLINK", frames });
    expect(result.outcome).toBe("FAILED_TIMEOUT");
  });

  it("respects a custom policy's minContinuousFrames and timeLimitSeconds", () => {
    const frames = [frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }, 0), frame({ eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }, 100)];
    const lenientPolicy = { ...DEFAULT_LIVENESS_POLICY, minContinuousFrames: 2 };
    const result = evaluateLivenessChallenge({ challenge: "BLINK", frames, policy: lenientPolicy });
    expect(result.outcome).toBe("PASSED");
  });
});

describe("Phase 9E: shouldEscalateAfterFailure", () => {
  it("does not escalate before maxRetries is reached", () => {
    expect(shouldEscalateAfterFailure({ attempts: 1, maxRetries: 2 })).toBe(false);
  });

  it("escalates once attempts reaches maxRetries", () => {
    expect(shouldEscalateAfterFailure({ attempts: 2, maxRetries: 2 })).toBe(true);
    expect(shouldEscalateAfterFailure({ attempts: 3, maxRetries: 2 })).toBe(true);
  });
});
