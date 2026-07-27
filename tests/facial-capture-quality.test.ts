import { describe, it, expect } from "vitest";
import { evaluateCaptureQuality, DEFAULT_CAPTURE_QUALITY_POLICY, type FaceDetectionSummary } from "@/lib/facial-verification/capture-quality";

function goodSummary(overrides: Partial<FaceDetectionSummary> = {}): FaceDetectionSummary {
  return {
    faceCount: 1,
    boundingBox: { x: 400, y: 250, width: 320, height: 320 },
    frameWidth: 1280,
    frameHeight: 720,
    detectionConfidence: 0.95,
    brightnessMean: 120,
    sharpnessScore: 30,
    ...overrides,
  };
}

describe("Phase 9C: capture-quality", () => {
  it("passes a well-framed, well-lit, sharp, single-face capture", () => {
    const result = evaluateCaptureQuality(goodSummary());
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.score).toBe(1);
  });

  it("flags NO_FACE when no face is detected", () => {
    const result = evaluateCaptureQuality(goodSummary({ faceCount: 0 }));
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("NO_FACE");
  });

  it("flags MULTIPLE_FACES when more than one face is in frame", () => {
    const result = evaluateCaptureQuality(goodSummary({ faceCount: 2 }));
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("MULTIPLE_FACES");
  });

  it("flags FACE_TOO_SMALL when the bounding box is below the minimum area ratio", () => {
    const result = evaluateCaptureQuality(goodSummary({ boundingBox: { x: 620, y: 340, width: 40, height: 40 } }));
    expect(result.issues).toContain("FACE_TOO_SMALL");
  });

  it("flags FACE_OFF_CENTER when the face is not roughly centered", () => {
    const result = evaluateCaptureQuality(goodSummary({ boundingBox: { x: 1000, y: 250, width: 200, height: 200 } }));
    expect(result.issues).toContain("FACE_OFF_CENTER");
  });

  it("flags TOO_DARK below the minimum brightness", () => {
    const result = evaluateCaptureQuality(goodSummary({ brightnessMean: 10 }));
    expect(result.issues).toContain("TOO_DARK");
  });

  it("flags TOO_BRIGHT above the maximum brightness", () => {
    const result = evaluateCaptureQuality(goodSummary({ brightnessMean: 250 }));
    expect(result.issues).toContain("TOO_BRIGHT");
  });

  it("flags TOO_BLURRY below the minimum sharpness", () => {
    const result = evaluateCaptureQuality(goodSummary({ sharpnessScore: 2 }));
    expect(result.issues).toContain("TOO_BLURRY");
  });

  it("flags LOW_DETECTION_CONFIDENCE below the minimum confidence", () => {
    const result = evaluateCaptureQuality(goodSummary({ detectionConfidence: 0.3 }));
    expect(result.issues).toContain("LOW_DETECTION_CONFIDENCE");
  });

  it("accumulates multiple simultaneous issues and lowers the score accordingly", () => {
    const result = evaluateCaptureQuality(goodSummary({ brightnessMean: 10, sharpnessScore: 2 }));
    expect(result.issues).toEqual(expect.arrayContaining(["TOO_DARK", "TOO_BLURRY"]));
    expect(result.score).toBeLessThan(1);
  });

  it("respects a custom policy", () => {
    const strictPolicy = { ...DEFAULT_CAPTURE_QUALITY_POLICY, minBrightness: 150 };
    const result = evaluateCaptureQuality(goodSummary({ brightnessMean: 120 }), strictPolicy);
    expect(result.issues).toContain("TOO_DARK");
  });
});
