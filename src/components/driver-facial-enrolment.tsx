"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  isFacialCaptureSupported,
  loadFaceLandmarker,
  detectFaceFrame,
  computeBrightness,
  computeSharpness,
  computeDescriptorFromVideoFrame,
} from "@/lib/facial-verification/browser-engine";
import { evaluateCaptureQuality, type FaceDetectionSummary } from "@/lib/facial-verification/capture-quality";
import { SYNTHETIC_BIOMETRIC_LABEL } from "@/lib/facial-verification/contracts";

/**
 * Driver biometric enrolment capture (Phase 9C). Restricted-role gated at
 * the API layer (`facialTemplate:CREATE`) — this component assumes the
 * page embedding it has already confirmed the caller holds that
 * permission. Shows the biometric-processing notice and purpose/retention
 * acknowledgement before the camera is even requested; captures 3-5
 * guided shots, each checked for one-face-in-frame, lighting, blur, and
 * face size/position before being accepted. Never stores or uploads raw
 * video — only the resulting numeric descriptor per accepted capture.
 */

const REQUIRED_CAPTURES = 3;
const MAX_CAPTURES = 5;

type EnrolmentState = "consent" | "starting-camera" | "capturing" | "submitting" | "done" | "error";

export function DriverFacialEnrolmentCapture({ driverId, onEnrolled }: { driverId: string; onEnrolled?: () => void }) {
  const [state, setState] = useState<EnrolmentState>("consent");
  const [consentChecked, setConsentChecked] = useState(false);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [lawfulAuthority, setLawfulAuthority] = useState<"CONSENT" | "APPROVED_ALTERNATIVE">("CONSENT");
  const [lawfulAuthorityReference, setLawfulAuthorityReference] = useState("");
  const [captures, setCaptures] = useState<number[][]>([]);
  const [liveIssues, setLiveIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestFrameRef = useRef<{ boundingBoxPx: { x: number; y: number; width: number; height: number } | null; quality: ReturnType<typeof evaluateCaptureQuality> | null }>({ boundingBoxPx: null, quality: null });

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const runDetectionLoop = useCallback(async () => {
    if (!videoRef.current) return;
    const landmarker = await loadFaceLandmarker();

    const measurementCanvas = document.createElement("canvas");
    const loop = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const frame = detectFaceFrame(landmarker, video, performance.now(), video.videoWidth, video.videoHeight);

      let brightnessMean = 128;
      let sharpnessScore = 30;
      if (frame.boundingBoxPx) {
        measurementCanvas.width = video.videoWidth;
        measurementCanvas.height = video.videoHeight;
        const ctx = measurementCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const imageData = ctx.getImageData(0, 0, measurementCanvas.width, measurementCanvas.height);
          brightnessMean = computeBrightness(imageData);
          sharpnessScore = computeSharpness(imageData);
        }
      }

      const summary: FaceDetectionSummary = {
        faceCount: frame.faceCount,
        boundingBox: frame.boundingBoxPx ?? { x: 0, y: 0, width: 0, height: 0 },
        frameWidth: video.videoWidth,
        frameHeight: video.videoHeight,
        detectionConfidence: frame.detectionConfidence,
        brightnessMean,
        sharpnessScore,
      };
      const quality = evaluateCaptureQuality(summary);
      latestFrameRef.current = { boundingBoxPx: frame.boundingBoxPx, quality };
      setLiveIssues(quality.issues);

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  async function startCamera() {
    setError(null);
    if (!isFacialCaptureSupported()) {
      setState("error");
      setError("Camera capture is not supported in this browser.");
      return;
    }
    setState("starting-camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      await runDetectionLoop();
      setState("capturing");
    } catch {
      setState("error");
      setError("Camera access was denied or is unavailable. Please allow camera access and try again.");
    }
  }

  async function captureNow() {
    const video = videoRef.current;
    const { boundingBoxPx, quality } = latestFrameRef.current;
    if (!video || !boundingBoxPx || !quality?.passed) return;

    try {
      const descriptor = await computeDescriptorFromVideoFrame(video, boundingBoxPx);
      setCaptures((prev) => [...prev, descriptor]);
    } catch {
      setError("Could not process this capture — please try again.");
    }
  }

  async function submitEnrolment(descriptors = captures, synthetic = false) {
    if (!consentChecked || !submissionConfirmed) return;
    stopCamera();
    setState("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/drivers/${driverId}/facial-enrolment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captureDescriptors: descriptors,
          consentAcknowledged: true,
          lawfulAuthority,
          lawfulAuthorityReference: lawfulAuthority === "APPROVED_ALTERNATIVE" ? lawfulAuthorityReference : undefined,
          noticeVersion: "phase17a-biometric-notice-v1",
          retentionPolicyVersion: "phase17a-pending-approval-v1",
          synthetic,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Enrolment failed");
        setState("error");
        return;
      }
      setState("done");
      onEnrolled?.();
    } catch {
      setError("Could not reach the server. Please try again.");
      setState("error");
    }
  }

  function syntheticDescriptor(seed: number): number[] {
    return Array.from({ length: 128 }, (_, index) => Math.sin(seed + index) * 0.1);
  }

  async function createSyntheticEnrolment() {
    const seed = Array.from(driverId).reduce((total, character) => total + character.charCodeAt(0), 17);
    const descriptors = [0, 1, 2].map((offset) =>
      syntheticDescriptor(seed).map((value, index) => value + Math.sin(offset + index) * 0.001),
    );
    await submitEnrolment(descriptors, true);
  }

  const canCaptureMore = captures.length < MAX_CAPTURES;
  const readyToSubmit = captures.length >= REQUIRED_CAPTURES;

  return (
    <div className="space-y-4 rounded-md border border-slate-200 p-4">
      {state === "consent" && (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-slate-900">Biometric-processing notice</p>
          <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 font-semibold text-sky-900" role="note">
            {SYNTHETIC_BIOMETRIC_LABEL}
          </p>
          <p className="text-slate-600">
            This will capture and process images of the driver&apos;s face to create an encrypted biometric template used
            solely for verifying this driver&apos;s identity at the gate. No raw enrolment video is stored — only the
            resulting numeric template. Retention and deletion follow the approved tenant policy; the current Phase
            17A internal candidate does not approve real biometric collection. Use the synthetic option for rehearsal.
          </p>
          <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
            <legend className="px-1 font-medium">Lawful authority recorded for this enrolment</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="lawfulAuthority" checked={lawfulAuthority === "CONSENT"} onChange={() => setLawfulAuthority("CONSENT")} />
              Driver consent after notice
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="lawfulAuthority" checked={lawfulAuthority === "APPROVED_ALTERNATIVE"} onChange={() => setLawfulAuthority("APPROVED_ALTERNATIVE")} />
              Approved alternative lawful authority
            </label>
            {lawfulAuthority === "APPROVED_ALTERNATIVE" && (
              <label className="block">
                <span className="mb-1 block">Non-sensitive approval reference</span>
                <input value={lawfulAuthorityReference} onChange={(event) => setLawfulAuthorityReference(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" required />
              </label>
            )}
          </fieldset>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
            I confirm this notice has been shown to the driver and they acknowledge the purpose and retention terms.
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={submissionConfirmed} onChange={(e) => setSubmissionConfirmed(e.target.checked)} />
            I confirm the selected driver, tenant, authority and synthetic/test status before submission.
          </label>
          <button
            type="button"
            disabled={!consentChecked || !submissionConfirmed || (lawfulAuthority === "APPROVED_ALTERNATIVE" && !lawfulAuthorityReference.trim())}
            onClick={createSyntheticEnrolment}
            className="mr-2 rounded-md bg-sky-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Create synthetic test enrolment
          </button>
          <button
            type="button"
            disabled={!consentChecked || !submissionConfirmed || (lawfulAuthority === "APPROVED_ALTERNATIVE" && !lawfulAuthorityReference.trim())}
            onClick={startCamera}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Start local camera capture (not pilot-approved)
          </button>
        </div>
      )}

      {state === "starting-camera" && <p className="text-sm text-slate-500">Requesting camera access…</p>}

      {(state === "capturing" || state === "starting-camera") && (
        <div className="space-y-3">
          <video ref={videoRef} muted playsInline className="w-full max-w-sm rounded bg-black" />
          {state === "capturing" && (
            <>
              <p className="text-sm text-slate-700">
                Capture {captures.length} of {REQUIRED_CAPTURES} (minimum) — up to {MAX_CAPTURES}
              </p>
              {liveIssues.length > 0 && (
                <ul className="list-inside list-disc text-xs text-amber-700">
                  {liveIssues.map((issue) => (
                    <li key={issue}>{issue.replaceAll("_", " ").toLowerCase()}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!canCaptureMore || liveIssues.length > 0}
                  onClick={captureNow}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Capture
                </button>
                <button
                  type="button"
                  disabled={!readyToSubmit}
                  onClick={() => submitEnrolment()}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
                >
                  Finish enrolment ({captures.length})
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {state === "submitting" && <p className="text-sm text-slate-500">Submitting enrolment…</p>}
      {state === "done" && <p className="text-sm font-medium text-emerald-700">Driver enrolled successfully.</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
