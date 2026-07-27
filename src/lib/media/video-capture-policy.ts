/**
 * Pure, DB-free, browser-API-free video-capture policy logic (Phase 8E-006)
 * — same "pure module" pattern as lib/gate-events/state-machine.ts and
 * lib/retention/deletion-rules.ts. Kept separate from the actual capture
 * component (components/video-capture-recorder.tsx) specifically so the
 * size/duration/mime-type decisions are unit-testable without a real
 * browser, camera, or MediaRecorder implementation.
 *
 * Mirrors the server-side video policy already defined in
 * lib/storage/video-compression.ts (720p, 24-30fps, 30-60s configurable,
 * configurable target bitrate) — this is the client-side enforcement of
 * that same policy, applied before a recording is ever uploaded, not a
 * competing definition of it.
 */

export interface VideoCapturePolicy {
  /** Clamped to [30, 60] by clampMaxDurationSeconds() — never trust an unclamped caller-supplied value. */
  maxDurationSeconds: number;
  targetBitrateKbps: number;
  maxUploadBytes: number;
  targetWidthPx: number;
  targetHeightPx: number;
  minFps: number;
  maxFps: number;
}

export const DEFAULT_VIDEO_CAPTURE_POLICY: VideoCapturePolicy = {
  maxDurationSeconds: 60,
  targetBitrateKbps: 2500,
  // Same ceiling as the server's own ContentLength check (MAX_VIDEO_BYTES,
  // lib/storage/media-categories.ts) — the client rejection exists to give
  // the driver/officer immediate feedback before spending time uploading,
  // never to be the only enforcement layer; the server re-checks
  // independently and does not trust this client-side pass.
  maxUploadBytes: 200 * 1024 * 1024,
  targetWidthPx: 1280,
  targetHeightPx: 720,
  minFps: 24,
  maxFps: 30,
};

/** 30-60s, per the documented policy range — never silently accepts a value outside it. */
export function clampMaxDurationSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_VIDEO_CAPTURE_POLICY.maxDurationSeconds;
  return Math.min(60, Math.max(30, Math.round(seconds)));
}

/** Rough pre-recording estimate only — the real check is against the actual encoded blob size after recording stops (checkCapturedVideoAgainstPolicy). */
export function estimateFileSizeBytes(durationSeconds: number, bitrateKbps: number): number {
  return Math.round((durationSeconds * bitrateKbps * 1000) / 8);
}

export interface CapturedVideoMetadata {
  actualWidthPx: number | null;
  actualHeightPx: number | null;
  actualFrameRate: number | null;
  actualDurationSeconds: number;
  actualBitrateKbps: number;
  actualFileSizeBytes: number;
  mimeType: string;
  /**
   * Always `false` for this component — the browser's own MediaRecorder
   * encoding is not "compression applied to policy spec" in the sense the
   * server-side VideoCompressionProvider means it (lib/storage/video-compression.ts);
   * the actual container/codec/resolution/bitrate the browser negotiated may
   * not exactly match the requested target. Recording this honestly as
   * `false` here is what lets the server (PassthroughVideoCompressionProvider)
   * continue to be the single source of truth for whether real,
   * spec-verified transcoding happened — this field must never be
   * overridden to `true` on the client.
   */
  actualCompressionApplied: false;
}

export type VideoPolicyViolationCode = "EXCEEDS_MAX_UPLOAD_BYTES" | "EXCEEDS_MAX_DURATION";

export interface VideoPolicyViolation {
  code: VideoPolicyViolationCode;
  message: string;
}

/** One second of grace on duration — MediaRecorder.stop() is asynchronous and can capture a trailing chunk after the stop timer fires. */
const DURATION_GRACE_SECONDS = 1;

export function checkCapturedVideoAgainstPolicy(metadata: CapturedVideoMetadata, policy: VideoCapturePolicy): VideoPolicyViolation | null {
  if (metadata.actualFileSizeBytes > policy.maxUploadBytes) {
    return {
      code: "EXCEEDS_MAX_UPLOAD_BYTES",
      message: `Recording is ${(metadata.actualFileSizeBytes / 1024 / 1024).toFixed(1)}MB, which exceeds the ${Math.round(policy.maxUploadBytes / 1024 / 1024)}MB limit. Please re-record a shorter clip.`,
    };
  }
  if (metadata.actualDurationSeconds > policy.maxDurationSeconds + DURATION_GRACE_SECONDS) {
    return {
      code: "EXCEEDS_MAX_DURATION",
      message: `Recording is ${metadata.actualDurationSeconds.toFixed(1)}s, which exceeds the ${policy.maxDurationSeconds}s limit.`,
    };
  }
  return null;
}

// Preference order: H.264/mp4 first (widest downstream compatibility, and
// what the server-side policy names as its target container/codec — see
// video-compression.ts), falling back to the VP9/VP8-in-WebM codecs that
// Chromium/Firefox's MediaRecorder actually support in practice (most of
// those browsers cannot record mp4/h264 at all). Whichever one is actually
// selected is recorded honestly in CapturedVideoMetadata.mimeType — never
// reported as h264/mp4 when the browser actually produced VP8/VP9/WebM.
export const VIDEO_CAPTURE_MIME_CANDIDATES = ["video/mp4;codecs=h264", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

/** Injectable `isTypeSupported` so this is unit-testable without a real MediaRecorder global. */
export function pickSupportedMimeType(candidates: readonly string[], isTypeSupported: (mimeType: string) => boolean): string | null {
  for (const candidate of candidates) {
    if (isTypeSupported(candidate)) return candidate;
  }
  return null;
}

export function estimateBitrateKbps(fileSizeBytes: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.round((fileSizeBytes * 8) / durationSeconds / 1000);
}
