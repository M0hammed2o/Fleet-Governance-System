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
import { SYNTHETIC_BIOMETRIC_LABEL } from "@/lib/facial-verification/contracts";
import type { BiometricSimulatorScenario } from "@/lib/facial-verification/simulator";

/**
 * Gate-tablet facial verification (Phase 9D/9E/9H): a random active
 * liveness challenge, then a one-to-one match against the assigned
 * driver's own enrolled template — server-side, this gate event's driver
 * only, never a global search (see runOnDeviceFacialVerificationAttempt()).
 * Large, simple states; no raw confidence score is ever shown here — only
 * a plain outcome and the next action.
 */

type Phase = "idle" | "starting-camera" | "challenge" | "verifying" | "result" | "error";

// Short, non-technical categories recorded on the audited attempt when the
// on-device provider itself could not run (camera denied, unsupported
// browser, or the biometric model failed to load) — never a raw error
// message or stack trace, just enough for later audit review (P9F-001).
type ProviderUnavailableReason = "browser_unsupported" | "camera_unavailable" | "model_load_failed";

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
    providerUnavailable?: boolean;
    deviceLabel?: string;
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
        // A genuine failure to reach/complete the API call — distinct from a
        // recorded PROVIDER_UNAVAILABLE attempt below, which always reaches
        // the server and is audited. No technical detail (status text,
        // stack trace) is shown here, only the server's own safe message.
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

  /**
   * P9F-001: whenever the on-device provider itself cannot run (camera
   * permission denied, unsupported browser, or the biometric model failing
   * to load), this reports a real, audited PROVIDER_UNAVAILABLE attempt via
   * the same API path as every other outcome — never a silent local-only
   * error state. The gate event is never advanced (submitAttempt only
   * advances on a genuine MATCH), and the officer is shown a safe, generic
   * message plus a retry/escalate/manual-fallback route — never a stack
   * trace, secret, or raw confidence value.
   */
  async function reportProviderUnavailable(reason: ProviderUnavailableReason) {
    stopCamera();
    await submitAttempt({ livenessResult: "NOT_REQUIRED", providerUnavailable: true, deviceLabel: reason });
  }

  async function startChallenge() {
    setError(null);
    if (!isFacialCaptureSupported()) {
      await reportProviderUnavailable("browser_unsupported");
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
      await reportProviderUnavailable("camera_unavailable");
      return;
    }

    const selectedChallenge = pickRandomChallenge();
    setChallenge(selectedChallenge);
    setPhase("challenge");

    let landmarker;
    try {
      landmarker = await loadFaceLandmarker();
    } catch {
      await reportProviderUnavailable("model_load_failed");
      return;
    }
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

  async function runSyntheticScenario(scenario: BiometricSimulatorScenario) {
    setError(null);
    setPhase("verifying");
    try {
      const res = await fetch(`/api/gate/gate-events/${gateEventId}/facial-verification/simulator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Synthetic verification failed");
        setPhase("error");
        return;
      }
      const result: string = data.attempt.result;
      setResultLabel(result);
      setPhase("result");
      onVerified?.({ result, gateEventVerified: result === "MATCH" });
    } catch {
      setError("Could not reach the server. No result was recorded.");
      setPhase("error");
    }
  }

  function retry() {
    setResultLabel(null);
    setPhase("idle");
  }

  return (
    <div className="space-y-4 rounded-md border border-slate-200 p-4">
      {phase === "idle" && (
        <div className="space-y-3">
          <button type="button" onClick={startChallenge} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Start local one-to-one verification
          </button>
          <div className="rounded-md border border-sky-300 bg-sky-50 p-3">
            <p className="text-sm font-semibold text-sky-900" role="note">{SYNTHETIC_BIOMETRIC_LABEL}</p>
            <p className="mt-1 text-xs text-sky-800">Internal rehearsal only. No face, camera image, or real biometric template is used.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                ["SUCCESS", "Synthetic verified"],
                ["NON_MATCH", "Synthetic non-match"],
                ["LIVENESS_FAILURE", "Synthetic liveness failure"],
                ["PROVIDER_OUTAGE", "Synthetic unavailable"],
                ["MANUAL_FALLBACK", "Synthetic indeterminate"],
              ] as const).map(([scenario, label]) => (
                <button key={scenario} type="button" onClick={() => runSyntheticScenario(scenario)} className="min-h-11 rounded-md border border-sky-400 bg-white px-3 py-2 text-xs font-medium text-sky-900">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
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
          ) : resultLabel === "PROVIDER_UNAVAILABLE" ? (
            // P9F-001: never rendered as a success or a plain "not verified"
            // failure — a clearly distinct, safe state. The attempt has
            // already been recorded server-side (audited); this is not a
            // silent local-only error. No technical detail is shown.
            <>
              <p className="text-2xl font-bold text-amber-700">Facial verification unavailable</p>
              <p className="text-sm text-slate-600">
                This device could not complete facial verification. This attempt has been recorded. Retry, or ask a
                supervisor to complete manual verification.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={retry} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
                  Try again
                </button>
                <span className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Escalate to a supervisor for manual fallback if this continues.
                </span>
              </div>
            </>
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
