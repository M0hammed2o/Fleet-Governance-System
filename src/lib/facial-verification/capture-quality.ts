/**
 * Pure, DB-free, browser-free capture-quality evaluation (Phase 9C) — the
 * client computes a `FaceDetectionSummary` from MediaPipe's detection
 * output plus a simple brightness/sharpness pass over the captured frame,
 * and this module decides whether that specific capture is good enough to
 * use for enrolment (or a live verification attempt). Same "pure module"
 * pattern as lib/gate-events/state-machine.ts.
 */

export interface FaceDetectionSummary {
  faceCount: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  frameWidth: number;
  frameHeight: number;
  detectionConfidence: number;
  /** Mean pixel luminance, 0-255. */
  brightnessMean: number;
  /** Higher = sharper. A simple client-side heuristic (e.g. Laplacian-variance-style edge energy), not a calibrated absolute unit. */
  sharpnessScore: number;
}

export type CaptureQualityIssueCode =
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "FACE_TOO_SMALL"
  | "FACE_OFF_CENTER"
  | "TOO_DARK"
  | "TOO_BRIGHT"
  | "TOO_BLURRY"
  | "LOW_DETECTION_CONFIDENCE";

export interface CaptureQualityPolicy {
  minFaceAreaRatio: number;
  maxCenterOffsetRatio: number;
  minBrightness: number;
  maxBrightness: number;
  minSharpness: number;
  minDetectionConfidence: number;
}

export const DEFAULT_CAPTURE_QUALITY_POLICY: CaptureQualityPolicy = {
  // BlazeFace's own model card (FACIAL_VERIFICATION_LICENSING.md) documents
  // its own training attribute as "face bounding box sides should be at
  // least 20% of the corresponding image sides" — 20% x 20% implies an area
  // ratio of roughly 4%; an enrolment/verification capture is deliberately
  // held to a stricter close-up standard than that baseline.
  minFaceAreaRatio: 0.08,
  maxCenterOffsetRatio: 0.25,
  minBrightness: 60,
  maxBrightness: 200,
  minSharpness: 15,
  minDetectionConfidence: 0.7,
};

export interface CaptureQualityCheck {
  passed: boolean;
  issues: CaptureQualityIssueCode[];
  /** [0, 1] composite score — 1 means no issues; each issue lowers it. Informational, not itself the pass/fail decision. */
  score: number;
}

export function evaluateCaptureQuality(summary: FaceDetectionSummary, policy: CaptureQualityPolicy = DEFAULT_CAPTURE_QUALITY_POLICY): CaptureQualityCheck {
  const issues: CaptureQualityIssueCode[] = [];

  if (summary.faceCount === 0) {
    issues.push("NO_FACE");
  } else if (summary.faceCount > 1) {
    issues.push("MULTIPLE_FACES");
  } else {
    const areaRatio = (summary.boundingBox.width * summary.boundingBox.height) / (summary.frameWidth * summary.frameHeight);
    if (areaRatio < policy.minFaceAreaRatio) issues.push("FACE_TOO_SMALL");

    const centerX = summary.boundingBox.x + summary.boundingBox.width / 2;
    const centerY = summary.boundingBox.y + summary.boundingBox.height / 2;
    const offsetX = Math.abs(centerX - summary.frameWidth / 2) / summary.frameWidth;
    const offsetY = Math.abs(centerY - summary.frameHeight / 2) / summary.frameHeight;
    if (offsetX > policy.maxCenterOffsetRatio || offsetY > policy.maxCenterOffsetRatio) issues.push("FACE_OFF_CENTER");

    if (summary.detectionConfidence < policy.minDetectionConfidence) issues.push("LOW_DETECTION_CONFIDENCE");
  }

  if (summary.brightnessMean < policy.minBrightness) issues.push("TOO_DARK");
  if (summary.brightnessMean > policy.maxBrightness) issues.push("TOO_BRIGHT");
  if (summary.sharpnessScore < policy.minSharpness) issues.push("TOO_BLURRY");

  const score = issues.length === 0 ? 1 : Math.max(0, 1 - issues.length * 0.2);
  return { passed: issues.length === 0, issues, score };
}
