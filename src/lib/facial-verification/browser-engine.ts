"use client";

/**
 * Client-only browser engine wiring MediaPipe (detection/landmarks/liveness
 * geometry) and face-api.js's face-recognition descriptor model together —
 * see FACIAL_VERIFICATION_LICENSING.md for exactly which package/model
 * combination this is and why. Never imported from server code (the models
 * themselves only exist in the browser bundle).
 *
 * Both libraries are loaded via dynamic `import()` inside the functions
 * that actually need them, not as static top-level imports — a static
 * import gets evaluated during Next.js's server-side render pass even for
 * a `"use client"` module (the component still renders once on the
 * server before hydrating), and face-api.js's browser bundle assumes
 * browser globals (e.g. `window.TextEncoder`) that don't exist in that
 * SSR pass, crashing the page. Dynamic `import()` only resolves when
 * these functions are actually called, which only ever happens from a
 * browser event handler after hydration.
 *
 * Deliberately loads ONLY `faceapi.nets.faceRecognitionNet` — never
 * face-api.js's own face-detection or 68-point-landmark/alignment models
 * (FACIAL_VERIFICATION_LICENSING.md "Explicitly excluded" — the 68-point
 * model's training-data licence excludes commercial use). Detection and
 * the face crop used as input to the descriptor model both come from
 * MediaPipe's FaceLandmarker instead (Apache-2.0, both code and model —
 * verified directly against Google's own published model cards).
 */

import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type * as FaceApiModule from "@vladmandic/face-api";

const MEDIAPIPE_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const FACE_LANDMARKER_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const FACE_DESCRIPTOR_MODEL_URI = "/models/face-recognition";

// Standard MediaPipe FaceMesh landmark indices.
const NOSE_TIP_INDEX = 1;
const LEFT_EYE_OUTER_INDEX = 33;
const RIGHT_EYE_OUTER_INDEX = 263;

let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;
let faceApiModulePromise: Promise<typeof FaceApiModule> | null = null;

export function isFacialCaptureSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const filesetResolver = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
      return FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    })();
  }
  return faceLandmarkerPromise;
}

/** Loads only the CC0-licensed face-recognition descriptor model — see this file's module docstring. */
async function loadFaceDescriptorModel(): Promise<typeof FaceApiModule> {
  if (!faceApiModulePromise) {
    faceApiModulePromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_DESCRIPTOR_MODEL_URI);
      return faceapi;
    })();
  }
  return faceApiModulePromise;
}

export interface DetectedFaceFrame {
  faceCount: number;
  /** Pixel-space bounding box derived from the landmark extents, not MediaPipe's own detector box (only the landmarker is loaded — see this file's docstring). */
  boundingBoxPx: { x: number; y: number; width: number; height: number } | null;
  landmarks: FaceLandmarkerResult["faceLandmarks"][number] | null;
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  /** A simple, approximate heuristic (nose-tip offset relative to inter-eye midpoint, scaled) — not derived from MediaPipe's full 3D transformation matrix. Documented as approximate, sufficient for a basic liveness threshold, not a precision pose estimate. */
  headYawDegrees: number;
  detectionConfidence: number;
}

function blendshapeScore(result: FaceLandmarkerResult, name: string): number {
  const categories = result.faceBlendshapes[0]?.categories ?? [];
  return categories.find((c) => c.categoryName === name)?.score ?? 0;
}

export function detectFaceFrame(landmarker: FaceLandmarker, video: HTMLVideoElement, timestampMs: number, frameWidth: number, frameHeight: number): DetectedFaceFrame {
  const result = landmarker.detectForVideo(video, timestampMs);
  const faceCount = result.faceLandmarks.length;

  if (faceCount === 0) {
    return { faceCount: 0, boundingBoxPx: null, landmarks: null, eyeBlinkLeft: 0, eyeBlinkRight: 0, headYawDegrees: 0, detectionConfidence: 0 };
  }

  const landmarks = result.faceLandmarks[0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  const boundingBoxPx = {
    x: minX * frameWidth,
    y: minY * frameHeight,
    width: (maxX - minX) * frameWidth,
    height: (maxY - minY) * frameHeight,
  };

  const noseX = landmarks[NOSE_TIP_INDEX].x;
  const leftEyeX = landmarks[LEFT_EYE_OUTER_INDEX].x;
  const rightEyeX = landmarks[RIGHT_EYE_OUTER_INDEX].x;
  const midEyeX = (leftEyeX + rightEyeX) / 2;
  const eyeDistance = Math.abs(rightEyeX - leftEyeX) || 1e-6;
  const yawRatio = (noseX - midEyeX) / eyeDistance;
  const headYawDegrees = yawRatio * 90;

  return {
    faceCount,
    boundingBoxPx,
    landmarks,
    eyeBlinkLeft: blendshapeScore(result, "eyeBlinkLeft"),
    eyeBlinkRight: blendshapeScore(result, "eyeBlinkRight"),
    headYawDegrees,
    detectionConfidence: faceCount > 0 ? 1 : 0, // FaceLandmarker doesn't expose a separate per-face confidence score; presence itself is the signal here
  };
}

/** Mean pixel luminance, 0-255 — a simple brightness heuristic (lib/facial-verification/capture-quality.ts). */
export function computeBrightness(imageData: ImageData): number {
  let sum = 0;
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4);
}

/** A simple gradient-energy sharpness heuristic (higher = sharper) — not a calibrated Laplacian variance, sufficient to reject a badly out-of-focus capture. */
export function computeSharpness(imageData: ImageData): number {
  const { data, width, height } = imageData;
  let energy = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 4) {
    for (let x = 1; x < width - 1; x += 4) {
      const i = (y * width + x) * 4;
      const iRight = (y * width + (x + 1)) * 4;
      const iDown = ((y + 1) * width + x) * 4;
      const gx = data[i] - data[iRight];
      const gy = data[i] - data[iDown];
      energy += Math.sqrt(gx * gx + gy * gy);
      samples++;
    }
  }
  return samples > 0 ? energy / samples : 0;
}

/** Crops the face region from the source video into a fresh canvas, then computes the face descriptor from that crop — never using face-api.js's own detector/landmark models (see this file's docstring). */
export async function computeDescriptorFromVideoFrame(video: HTMLVideoElement, boundingBoxPx: { x: number; y: number; width: number; height: number }): Promise<number[]> {
  const faceapi = await loadFaceDescriptorModel();

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(boundingBoxPx.width));
  canvas.height = Math.max(1, Math.round(boundingBoxPx.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire a 2D canvas context for face-crop extraction.");
  ctx.drawImage(video, boundingBoxPx.x, boundingBoxPx.y, boundingBoxPx.width, boundingBoxPx.height, 0, 0, canvas.width, canvas.height);

  const result = await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(canvas);
  const descriptor = Array.isArray(result) ? result[0] : result;
  return Array.from(descriptor);
}
