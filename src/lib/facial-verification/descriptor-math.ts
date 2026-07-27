/**
 * Pure, DB-free, browser-free math over face descriptors (Phase 9C/9D) —
 * same "pure module" pattern as lib/gate-events/state-machine.ts and
 * lib/retention/deletion-rules.ts. A descriptor is a small fixed-length
 * float array (128 dimensions for the dlib-derived model this codebase
 * uses — see FACIAL_VERIFICATION_LICENSING.md), never image bytes.
 */

export class DescriptorLengthMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`Descriptor length mismatch: expected ${expected}, got ${actual}.`);
    this.name = "DescriptorLengthMismatchError";
  }
}

export function euclideanDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new DescriptorLengthMismatchError(a.length, b.length);
  let sumSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumSquares += diff * diff;
  }
  return Math.sqrt(sumSquares);
}

/** The canonical enrolled template is the mean of several guided captures — reduces the influence of any single noisy capture. */
export function meanDescriptor(descriptors: readonly (readonly number[])[]): number[] {
  if (descriptors.length === 0) throw new Error("Cannot compute a mean of zero descriptors.");
  const length = descriptors[0].length;
  const sums = new Array(length).fill(0);
  for (const descriptor of descriptors) {
    if (descriptor.length !== length) throw new DescriptorLengthMismatchError(length, descriptor.length);
    for (let i = 0; i < length; i++) sums[i] += descriptor[i];
  }
  return sums.map((sum) => sum / descriptors.length);
}

// Same default threshold face-api.js/dlib's own documentation recommends
// (LFW-benchmark-tuned): euclidean distance < 0.6 between two descriptors
// is considered the same person. This codebase uses two thresholds, not
// one, to support a REVIEW_REQUIRED middle tier rather than a hard
// binary match/no-match — see evaluateMatch() below.
export const DEFAULT_MATCH_THRESHOLD = 0.5;
export const DEFAULT_REVIEW_THRESHOLD = 0.6;

export type DescriptorMatchOutcome = "MATCH" | "REVIEW_REQUIRED" | "NO_MATCH";

export interface DescriptorMatchResult {
  outcome: DescriptorMatchOutcome;
  distance: number;
  /** A simple, bounded [0,1] confidence figure derived from distance — for display only, the raw distance is what actually drove the decision. */
  confidence: number;
}

export function evaluateMatch(
  live: readonly number[],
  enrolled: readonly number[],
  matchThreshold: number = DEFAULT_MATCH_THRESHOLD,
  reviewThreshold: number = DEFAULT_REVIEW_THRESHOLD,
): DescriptorMatchResult {
  const distance = euclideanDistance(live, enrolled);
  const confidence = Math.max(0, Math.min(1, 1 - distance / reviewThreshold));
  if (distance <= matchThreshold) return { outcome: "MATCH", distance, confidence };
  if (distance <= reviewThreshold) return { outcome: "REVIEW_REQUIRED", distance, confidence };
  return { outcome: "NO_MATCH", distance, confidence };
}
