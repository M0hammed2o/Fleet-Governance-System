import { describe, expect, it } from "vitest";
import { trackerProvenanceDisplay } from "@/lib/telematics/provenance";

describe("tracker provenance labels", () => {
  it.each([
    [{ source: "SYNTHETIC", freshness: "FRESH", isSynthetic: true }, "SYNTHETIC", /not live/i],
    [{ source: "MANUAL", freshness: "FRESH", isSynthetic: false }, "MANUAL", /human-reported/i],
    [{ source: "ESTIMATED", freshness: "FRESH", isSynthetic: false }, "ESTIMATED", /derived/i],
    [{ source: "PROVIDER", freshness: "STALE", isSynthetic: false }, "DELAYED_PROVIDER", /stale|delayed/i],
    [{ source: null, freshness: null, isSynthetic: false }, "UNAVAILABLE", /not proof of misconduct/i],
  ] as const)("classifies visible provenance %#", (input, kind, warning) => {
    const display = trackerProvenanceDisplay(input);
    expect(display.kind).toBe(kind);
    expect(display.warning).toMatch(warning);
  });
});
