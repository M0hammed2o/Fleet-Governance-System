"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  DEFAULT_VIDEO_CAPTURE_POLICY,
  clampMaxDurationSeconds,
  estimateFileSizeBytes,
  estimateBitrateKbps,
  checkCapturedVideoAgainstPolicy,
  pickSupportedMimeType,
  VIDEO_CAPTURE_MIME_CANDIDATES,
  type VideoCapturePolicy,
  type CapturedVideoMetadata,
} from "@/lib/media/video-capture-policy";

/**
 * In-browser video capture with cost/policy controls (Phase 8E-006):
 * 720p target, 24-30fps, a configurable 30-60s maximum with a visible
 * countdown and automatic stop, a configurable target bitrate, a live
 * file-size estimate, and rejection of a recording that ends up exceeding
 * policy. Uses the browser's native MediaRecorder — no client-side
 * transcoding library exists or is bundled here (see
 * lib/storage/video-compression.ts for why: no ffmpeg/transcoder is
 * available in this environment), so `actualCompressionApplied` on the
 * resulting metadata is always `false` and the actual codec/container the
 * browser negotiated is reported honestly, never assumed to be h264/mp4.
 *
 * Camera permission handling, unsupported-browser handling, and a
 * discard-and-retry path for a rejected recording are all part of this
 * component; a parent that wants a non-camera fallback (e.g. the existing
 * plain `<input type="file">`) should render one when `onUnsupported` or
 * `onPermissionDenied` fires — this component does not assume there is no
 * other way to attach evidence.
 */

export type VideoCaptureRecorderState = "idle" | "requesting-permission" | "permission-denied" | "unsupported" | "ready" | "recording" | "policy-violation" | "error";

export interface VideoCaptureRecorderProps {
  policy?: Partial<VideoCapturePolicy>;
  fileName?: string;
  onCaptured: (file: File, metadata: CapturedVideoMetadata) => void;
  onUnsupported?: () => void;
  onPermissionDenied?: () => void;
}

function isCaptureSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export function VideoCaptureRecorder({ policy: policyOverrides, fileName = "evidence-video", onCaptured, onUnsupported, onPermissionDenied }: VideoCaptureRecorderProps) {
  // Memoized so every callback below that depends on `policy` gets a stable
  // reference across renders where the caller's `policyOverrides` prop
  // hasn't actually changed — a fresh object literal every render would
  // otherwise force every recording-control callback to be rebuilt on every
  // render for no reason.
  const policy: VideoCapturePolicy = useMemo(
    () => ({
      ...DEFAULT_VIDEO_CAPTURE_POLICY,
      ...policyOverrides,
      maxDurationSeconds: clampMaxDurationSeconds(policyOverrides?.maxDurationSeconds ?? DEFAULT_VIDEO_CAPTURE_POLICY.maxDurationSeconds),
    }),
    [policyOverrides],
  );

  const [state, setState] = useState<VideoCaptureRecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("video/webm");

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopTracks, [stopTracks]);

  const startCamera = useCallback(async () => {
    setErrorMessage(null);
    if (!isCaptureSupported()) {
      setState("unsupported");
      onUnsupported?.();
      return;
    }

    setState("requesting-permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: policy.targetWidthPx },
          height: { ideal: policy.targetHeightPx },
          // `ideal`, not a hard `min` — a hard minimum frame-rate constraint
          // throws OverconstrainedError and refuses to open the camera at
          // all on any device/browser that can't guarantee it (confirmed
          // live against Chromium's own fake-camera device during Phase
          // 8E-006 verification). The policy's fps range is enforced
          // honestly after the fact instead: whatever frame rate the
          // browser actually negotiates is what gets recorded in
          // CapturedVideoMetadata.actualFrameRate, never silently claimed
          // to be within [minFps, maxFps] when it wasn't.
          frameRate: { ideal: policy.maxFps, max: policy.maxFps },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setState("ready");
    } catch {
      setState("permission-denied");
      onPermissionDenied?.();
    }
  }, [policy.targetWidthPx, policy.targetHeightPx, policy.maxFps, onUnsupported, onPermissionDenied]);

  // Declared as its own callback (not inlined into startRecording) so
  // `recorder.onstop = handleRecordingStopped` assigns a stable,
  // React-recognized event-handler reference — the impure Date.now() /
  // Blob-construction work below only ever runs in response to the
  // MediaRecorder actually stopping, never during render.
  const handleRecordingStopped = useCallback(() => {
    const actualDurationSeconds = (Date.now() - startedAtRef.current) / 1000;
    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
    const track = streamRef.current?.getVideoTracks()[0];
    const settings = track?.getSettings();

    const metadata: CapturedVideoMetadata = {
      actualWidthPx: settings?.width ?? null,
      actualHeightPx: settings?.height ?? null,
      actualFrameRate: settings?.frameRate ?? null,
      actualDurationSeconds,
      actualBitrateKbps: estimateBitrateKbps(blob.size, actualDurationSeconds),
      actualFileSizeBytes: blob.size,
      mimeType: mimeTypeRef.current,
      actualCompressionApplied: false,
    };

    const violation = checkCapturedVideoAgainstPolicy(metadata, policy);
    if (violation) {
      setErrorMessage(violation.message);
      setState("policy-violation");
      stopTracks();
      return;
    }

    const extension = mimeTypeRef.current.startsWith("video/mp4") ? "mp4" : "webm";
    const file = new File([blob], `${fileName}.${extension}`, { type: mimeTypeRef.current });
    stopTracks();
    setState("idle");
    onCaptured(file, metadata);
  }, [policy, fileName, onCaptured, stopTracks]);

  const stopRecording = useCallback(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    recorderRef.current?.stop();
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = pickSupportedMimeType(VIDEO_CAPTURE_MIME_CANDIDATES, (t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      setState("unsupported");
      onUnsupported?.();
      return;
    }
    mimeTypeRef.current = mimeType;

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: policy.targetBitrateKbps * 1000 });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = handleRecordingStopped;
    recorderRef.current = recorder;

    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    recorder.start();
    setState("recording");

    tickIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setElapsedSeconds(elapsed);
      // Automatic stop at the configured maximum duration — the countdown
      // shown to the user (policy.maxDurationSeconds - elapsedSeconds)
      // reaches zero at exactly the same instant this fires.
      if (elapsed >= policy.maxDurationSeconds) {
        stopRecording();
      }
    }, 100);
  }, [policy.targetBitrateKbps, policy.maxDurationSeconds, onUnsupported, handleRecordingStopped, stopRecording]);

  function retryAfterViolation() {
    setErrorMessage(null);
    setState("idle");
  }

  const countdown = Math.max(0, policy.maxDurationSeconds - elapsedSeconds);
  const estimatedBytesSoFar = estimateFileSizeBytes(elapsedSeconds, policy.targetBitrateKbps);

  return (
    <div className="rounded-md border border-slate-200 p-3 text-sm">
      {state === "unsupported" && (
        <p className="text-xs text-amber-700">
          In-browser video recording is not supported in this browser. Use the file picker to attach a pre-recorded video instead.
        </p>
      )}

      {state === "permission-denied" && (
        <p className="text-xs text-amber-700">
          Camera access was denied or is unavailable. Use the file picker to attach a pre-recorded video instead, or allow camera
          access and try again.
        </p>
      )}

      {state === "policy-violation" && errorMessage && (
        <div className="space-y-2">
          <p className="text-xs text-red-700">{errorMessage}</p>
          <button type="button" onClick={retryAfterViolation} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
            Record again
          </button>
        </div>
      )}

      {(state === "idle" || state === "requesting-permission" || state === "ready" || state === "recording") && (
        <div className="space-y-2">
          <video ref={videoRef} muted playsInline className="w-full max-w-xs rounded bg-black" style={{ display: state === "ready" || state === "recording" ? "block" : "none" }} />

          {state === "idle" && (
            <button type="button" onClick={startCamera} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
              Start camera
            </button>
          )}

          {state === "requesting-permission" && <p className="text-xs text-slate-500">Requesting camera access…</p>}

          {state === "ready" && (
            <button type="button" onClick={startRecording} className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700">
              Start recording (max {policy.maxDurationSeconds}s)
            </button>
          )}

          {state === "recording" && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-red-700">Recording — stops automatically in {countdown.toFixed(0)}s</p>
              <p className="text-xs text-slate-500">Estimated size so far: {(estimatedBytesSoFar / 1024 / 1024).toFixed(1)}MB</p>
              <button type="button" onClick={stopRecording} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
                Stop now
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
