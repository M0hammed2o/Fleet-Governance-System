import { describe, it, expect } from "vitest";
import {
  euclideanDistance,
  meanDescriptor,
  evaluateMatch,
  DescriptorLengthMismatchError,
  DEFAULT_MATCH_THRESHOLD,
  DEFAULT_REVIEW_THRESHOLD,
} from "@/lib/facial-verification/descriptor-math";

describe("Phase 9D: descriptor-math", () => {
  it("euclideanDistance is 0 for identical descriptors", () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it("euclideanDistance computes the expected value for a simple case", () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });

  it("euclideanDistance throws on mismatched lengths", () => {
    expect(() => euclideanDistance([1, 2], [1, 2, 3])).toThrow(DescriptorLengthMismatchError);
  });

  it("meanDescriptor averages component-wise", () => {
    expect(meanDescriptor([[0, 0], [2, 4], [4, 8]])).toEqual([2, 4]);
  });

  it("meanDescriptor throws on an empty list", () => {
    expect(() => meanDescriptor([])).toThrow();
  });

  describe("evaluateMatch", () => {
    it("returns MATCH when distance is at or below the match threshold", () => {
      const enrolled = new Array(128).fill(0);
      const live = new Array(128).fill(0);
      live[0] = DEFAULT_MATCH_THRESHOLD; // distance exactly at the boundary
      const result = evaluateMatch(live, enrolled);
      expect(result.outcome).toBe("MATCH");
      expect(result.distance).toBeCloseTo(DEFAULT_MATCH_THRESHOLD, 5);
    });

    it("returns REVIEW_REQUIRED for a distance strictly between the two thresholds", () => {
      const enrolled = new Array(128).fill(0);
      const live = new Array(128).fill(0);
      const midpoint = (DEFAULT_MATCH_THRESHOLD + DEFAULT_REVIEW_THRESHOLD) / 2;
      live[0] = midpoint;
      const result = evaluateMatch(live, enrolled);
      expect(result.outcome).toBe("REVIEW_REQUIRED");
    });

    it("returns NO_MATCH for a distance beyond the review threshold", () => {
      const enrolled = new Array(128).fill(0);
      const live = new Array(128).fill(0);
      live[0] = DEFAULT_REVIEW_THRESHOLD + 1;
      const result = evaluateMatch(live, enrolled);
      expect(result.outcome).toBe("NO_MATCH");
    });

    it("confidence is 1 for an exact match and decreases as distance grows", () => {
      const enrolled = new Array(128).fill(0);
      const exact = evaluateMatch(enrolled, enrolled);
      expect(exact.confidence).toBe(1);

      const live = new Array(128).fill(0);
      live[0] = DEFAULT_REVIEW_THRESHOLD;
      const atReviewBoundary = evaluateMatch(live, enrolled);
      expect(atReviewBoundary.confidence).toBeLessThan(exact.confidence);
    });

    it("respects custom thresholds", () => {
      const enrolled = new Array(128).fill(0);
      const live = new Array(128).fill(0);
      live[0] = 0.9;
      const result = evaluateMatch(live, enrolled, 1.0, 1.5);
      expect(result.outcome).toBe("MATCH");
    });
  });
});
