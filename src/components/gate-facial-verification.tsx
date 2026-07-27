"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  isFacialCaptureSupported,
  loadFaceLandmarker,
  detectFaceFrame,
  computeDescriptorFromVideoFrame,
} from "@/lib/facial-verification/browser-engine";
import {
  pickRandomChallenge,
  evaluateLivenessChallenge,
  DEFAULT_LIVENESS_POLICY,
  shouldEscalateAfterFailure,
  type LivenessChallengeType,
  type LivenessFrameSignal,
} from "@/lib/facial-verification/liveness-challenge";

/**
 * Gate-tablet facial verification (Phase 9D/9E/9H): a random active
 * liveness challenge, then a one-to-one match against the assigned
 * driver's own enrolled template — server-side, this gate event's driver
 * only, never a global search (see runOnDeviceFacialVerificationAttempt()).
 * Large, simple states; no raw confidence score is ever shown here — only
 * a plain outcome and the next action.
 */

type Phase = "idle" | "starting-camera" | "challenge" | "verifying" | "result" | "error";

const CHALLENGE_LABELS: Record<LivenessChallengeType, string> = {
  BLINK: "Please blink",
  TURN_LEFT: "Please turn your head left",
  TURN_RIGHT: "Please turn your head right",
  MOVE_CLOSER: "Please move closer to the camera",
};

export interface GateFacialVerificationResult {
  result: string;
  gateEventVerified: boolean;
}

export function GateFacialVerification({ gateEventId, onVerified }: { gateEventId: string; onVerified?: (result: GateFacialVerificationResult) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [challenge, setChallenge] = useState<LivenessChallengeType | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [resultLabel, setResultLabel] = useState<string | null>(null);
  const [escalate, setEscalate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function submitAttempt(payload: {
    liveDescriptor?: number[];
    livenessResult: "PASSED" | "FAILED" | "NOT_REQUIRED" | "SKIPPED";
    livenessChallenge?: string;
    captureFailed?: boolean;
  }) {
    setPhase("verifying");
    try {
      const res = await fetch(`/api/gate/gate-events/${gateEventId}/facial-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed");
        setPhase("error");
        return;
      }
      const result: string = data.attempt.result;
      setResultLabel(result);
      setPhase("result");
      stopCamera();
      onVerified?.({ result, gateEventVerified: result === "MATCH" });

      if (result !== "MATCH") {
        const nextCount = attemptCount + 1;
        setAttemptCount(nextCount);
        if (shouldEscalateAfterFailure({ attempts: nextCount, maxRetries: DEFAULT_LIVENESS_POLICY.maxRetries })) {
          setEscalate(true);
        }
      }
    } catch {
      setError("Could not reach the server. Please try again.");
      setPhase("error");
    }
  }

  async function startChallenge() {
    setError(null);
    if (!isFacialCaptureSupported()) {
      setPhase("error");
      setError("Camera capture is not supported in this browser. Use manual fallback.");
      return;
    }
    setPhase("starting-camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setPhase("error");
      setError("Camera access was denied or is unavailable. Use manual fallback.");
      return;
    }

    const selectedChallenge = pickRandomChallenge();
    setChallenge(selectedChallenge);
    setPhase("challenge");

    const landmarker = await loadFaceLandmarker();
    const frames: LivenessFrameSignal[] = [];
    const areaRatios: number[] = [];
    let lastBoundingBox: { x: number; y: number; width: number; height: number } | null = null;
    const startTime = performance.now();

    const loop = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const now = performance.now();
      const frame = detectFaceFrame(landmarker, video, now, video.videoWidth, video.videoHeight);
      if (frame.faceCount === 1 && frame.boundingBoxPx) {
        frames.push({ eyeBlinkLeft: frame.eyeBlinkLeft, eyeBlinkRight: frame.eyeBlinkRight, headYawDegrees: frame.headYawDegrees, timestamp: now });
        areaRatios.push((frame.boundingBoxPx.width * frame.boundingBoxPx.height) / (video.videoWidth * video.videoHeight));
        lastBoundingBox = frame.boundingBoxPx;
      }

      const elapsedSeconds = (now - startTime) / 1000;
      const evaluation = evaluateLivenessChallenge({ challenge: selectedChallenge, frames, faceAreaRatios: areaRatios });

      if (evaluation.outcome === "PASSED") {
        (async () => {
          if (!lastBoundingBox) {
            await submitAttempt({ livenessResult: "PASSED", livenessChallenge: selectedChallenge, captureFailed: true });
            return;
          }
          try {
            const descriptor = await computeDescriptorFromVideoFrame(video, lastBoundingBox);
            await submitAttempt({ liveDescriptor: descriptor, livenessResult: "PASSED", livenessChallenge: selectedChallenge });
          } catch {
            await submitAttempt({ livenessResult: "PASSED", livenessChallenge: selectedChallenge, captureFailed: true });
          }
        })();
        return;
      }

      if (evaluation.outcome === "FAILED_TIMEOUT" || evaluation.outcome === "FAILED_STATIC_INPUT" || elapsedSeconds > DEFAULT_LIVENESS_POLICY.timeLimitSeconds) {
        submitAttempt({ livenessResult: "FAILED", livenessChallenge: selectedChallenge, captureFailed: true });
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function retry() {
    setResultLabel(null);
    setPhase("idle");
  }

  return (
    <div className="space-y-4 rounded-md border border-slate-200 p-4">
      {phase === "idle" && (
        <button type="button" onClick={startChallenge} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Start facial verification
        </button>
      )}

      {phase === "starting-camera" && <p className="text-sm text-slate-500">Requesting camera access…</p>}

      {(phase === "challenge" || phase === "verifying") && (
        <div className="space-y-3">
          <video ref={videoRef} muted playsInline className="w-full max-w-sm rounded bg-black" />
          {phase === "challenge" && challenge && <p className="text-lg font-semibold text-slate-900">{CHALLENGE_LABELS[challenge]}</p>}
          {phase === "verifying" && <p className="text-sm text-slate-500">Verifying…</p>}
        </div>
      )}

      {phase === "result" && resultLabel && (
        <div className="space-y-3">
          {resultLabel === "MATCH" ? (
            <p className="text-2xl font-bold text-emerald-700">Verified</p>
          ) : (
            <>
              <p className="text-2xl font-bold text-red-700">Not verified</p>
              {escalate ? (
                <p className="text-sm text-amber-700">Repeated failures — please escalate to a supervisor for manual fallback.</p>
              ) : (
                <button type="button" onClick={retry} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
                  Try again
                </button>
              )}
            </>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={retry} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
