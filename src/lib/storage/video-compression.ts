/**
 * Configurable video-compression *policy* (Phase 8B, ARCHITECTURE.md
 * "Videos": 720p, H.264/MP4 where supported, 24-30fps, configurable 30-60s
 * maximum, configurable target bitrate; higher quality permitted for
 * accidents/serious damage/investigations).
 *
 * Deliberately configuration + capture-metadata only in this phase, not a
 * working transcoder: real H.264 re-encoding needs an external
 * binary/library (ffmpeg, or a wrapper like fluent-ffmpeg) that is not
 * installed in this environment. Adding an untested, unverified video
 * pipeline and reporting "video compression implemented" would violate the
 * hard rule against overclaiming — this module defines the policy and the
 * `VideoCompressionProvider` interface a real transcoder plugs into, and
 * `PassthroughVideoCompressionProvider` stores the original bytes unchanged
 * while still recording the *intended* target profile and capture metadata,
 * so nothing about the upload pipeline needs to change again once a real
 * transcoder is wired in — only this one provider's implementation. Tracked
 * as a known, documented gap in TODO.md, not silently assumed working.
 */

export interface VideoCompressionProfile {
  maxHeightPx: 720;
  codec: "h264";
  container: "mp4";
  minFps: number;
  maxFps: number;
  maxDurationSeconds: number;
  targetBitrateKbps: number;
}

export const VIDEO_COMPRESSION_PROFILES: Record<"standard" | "high-quality", VideoCompressionProfile> = {
  standard: { maxHeightPx: 720, codec: "h264", container: "mp4", minFps: 24, maxFps: 30, maxDurationSeconds: 60, targetBitrateKbps: 2500 },
  "high-quality": { maxHeightPx: 720, codec: "h264", container: "mp4", minFps: 24, maxFps: 30, maxDurationSeconds: 60, targetBitrateKbps: 6000 },
};

export interface VideoCompressionResult {
  data: Buffer;
  contentType: string;
  /** Whether the returned bytes actually match `VIDEO_COMPRESSION_PROFILES[profile]`, or are the untranscoded original (this phase). */
  transcoded: boolean;
  profile: string;
}

export interface VideoCompressionProvider {
  compress(data: Buffer, contentType: string, profileName: "standard" | "high-quality"): Promise<VideoCompressionResult>;
}

/** Stores the original video unchanged — see this file's module docstring for why. */
export class PassthroughVideoCompressionProvider implements VideoCompressionProvider {
  async compress(data: Buffer, contentType: string, profileName: "standard" | "high-quality"): Promise<VideoCompressionResult> {
    return { data, contentType, transcoded: false, profile: profileName };
  }
}
