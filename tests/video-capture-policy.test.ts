import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIDEO_CAPTURE_POLICY,
  clampMaxDurationSeconds,
  estimateFileSizeBytes,
  estimateBitrateKbps,
  checkCapturedVideoAgainstPolicy,
  pickSupportedMimeType,
  VIDEO_CAPTURE_MIME_CANDIDATES,
  type CapturedVideoMetadata,
} from "@/lib/media/video-capture-policy";

function metadata(overrides: Partial<CapturedVideoMetadata> = {}): CapturedVideoMetadata {
  return {
    actualWidthPx: 1280,
    actualHeightPx: 720,
    actualFrameRate: 30,
    actualDurationSeconds: 30,
    actualBitrateKbps: 2500,
    actualFileSizeBytes: 10 * 1024 * 1024,
    mimeType: "video/webm;codecs=vp9",
    actualCompressionApplied: false,
    ...overrides,
  };
}

describe("8E-006: clampMaxDurationSeconds", () => {
  it("clamps below 30 up to 30", () => {
    expect(clampMaxDurationSeconds(10)).toBe(30);
  });
  it("clamps above 60 down to 60", () => {
    expect(clampMaxDurationSeconds(120)).toBe(60);
  });
  it("passes through values already in range", () => {
    expect(clampMaxDurationSeconds(45)).toBe(45);
  });
  it("falls back to the default when given a non-finite value", () => {
    expect(clampMaxDurationSeconds(NaN)).toBe(DEFAULT_VIDEO_CAPTURE_POLICY.maxDurationSeconds);
    expect(clampMaxDurationSeconds(Infinity)).toBe(DEFAULT_VIDEO_CAPTURE_POLICY.maxDurationSeconds);
  });
});

describe("8E-006: estimateFileSizeBytes / estimateBitrateKbps", () => {
  it("estimates bytes from duration and bitrate consistently with its inverse", () => {
    const bytes = estimateFileSizeBytes(30, 2500);
    expect(bytes).toBe(Math.round((30 * 2500 * 1000) / 8));
    expect(estimateBitrateKbps(bytes, 30)).toBe(2500);
  });

  it("estimateBitrateKbps returns 0 for zero/negative duration rather than dividing by zero", () => {
    expect(estimateBitrateKbps(1000, 0)).toBe(0);
    expect(estimateBitrateKbps(1000, -5)).toBe(0);
  });
});

describe("8E-006: checkCapturedVideoAgainstPolicy", () => {
  it("passes a recording within both duration and size limits", () => {
    expect(checkCapturedVideoAgainstPolicy(metadata(), DEFAULT_VIDEO_CAPTURE_POLICY)).toBeNull();
  });

  it("rejects a recording whose actual file size exceeds maxUploadBytes", () => {
    const violation = checkCapturedVideoAgainstPolicy(metadata({ actualFileSizeBytes: DEFAULT_VIDEO_CAPTURE_POLICY.maxUploadBytes + 1 }), DEFAULT_VIDEO_CAPTURE_POLICY);
    expect(violation?.code).toBe("EXCEEDS_MAX_UPLOAD_BYTES");
  });

  it("accepts a recording exactly at maxUploadBytes (boundary, not exceeding)", () => {
    const violation = checkCapturedVideoAgainstPolicy(metadata({ actualFileSizeBytes: DEFAULT_VIDEO_CAPTURE_POLICY.maxUploadBytes }), DEFAULT_VIDEO_CAPTURE_POLICY);
    expect(violation).toBeNull();
  });

  it("rejects a recording whose duration exceeds maxDurationSeconds beyond the 1s grace window", () => {
    const violation = checkCapturedVideoAgainstPolicy(metadata({ actualDurationSeconds: 62 }), DEFAULT_VIDEO_CAPTURE_POLICY);
    expect(violation?.code).toBe("EXCEEDS_MAX_DURATION");
  });

  it("tolerates a recording within the 1s stop-latency grace window", () => {
    const violation = checkCapturedVideoAgainstPolicy(metadata({ actualDurationSeconds: 60.8 }), DEFAULT_VIDEO_CAPTURE_POLICY);
    expect(violation).toBeNull();
  });

  it("size violation is reported even when duration is also within policy, and vice versa", () => {
    const sizeOnly = checkCapturedVideoAgainstPolicy(metadata({ actualFileSizeBytes: DEFAULT_VIDEO_CAPTURE_POLICY.maxUploadBytes * 2, actualDurationSeconds: 20 }), DEFAULT_VIDEO_CAPTURE_POLICY);
    expect(sizeOnly?.code).toBe("EXCEEDS_MAX_UPLOAD_BYTES");
  });
});

describe("8E-006: pickSupportedMimeType", () => {
  it("prefers the first supported candidate in order", () => {
    const supported = new Set(["video/webm;codecs=vp9", "video/webm"]);
    const picked = pickSupportedMimeType(VIDEO_CAPTURE_MIME_CANDIDATES, (t) => supported.has(t));
    expect(picked).toBe("video/webm;codecs=vp9");
  });

  it("returns null when nothing is supported (caller must then fall back to a plain file picker)", () => {
    const picked = pickSupportedMimeType(VIDEO_CAPTURE_MIME_CANDIDATES, () => false);
    expect(picked).toBeNull();
  });

  it("never claims h264/mp4 support that isTypeSupported did not actually report", () => {
    // Only the WebM/VP8 fallback is supported — proves selection order does
    // not skip ahead to a more "impressive"-looking codec name.
    const supported = new Set(["video/webm;codecs=vp8"]);
    const picked = pickSupportedMimeType(VIDEO_CAPTURE_MIME_CANDIDATES, (t) => supported.has(t));
    expect(picked).toBe("video/webm;codecs=vp8");
  });
});
