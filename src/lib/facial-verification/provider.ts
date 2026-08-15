/**
 * No facial-recognition model is built in-house (build brief 7.3/8). This
 * interface is the adapter boundary a real provider plugs into; only a
 * deterministic mock implementation exists in V1 (mock-provider.ts).
 * Production provider selection is blocked — see INTEGRATIONS.md.
 */

export type FacialVerificationResult =
  | "VERIFIED"
  | "NOT_VERIFIED"
  | "LIVENESS_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "MANUAL_FALLBACK_REQUIRED";

export interface FacialVerificationOutcome {
  result: FacialVerificationResult;
  providerReference: string;
  confidence?: number;
  verifiedAt: Date;
  failureReason?: string;
  synthetic: boolean;
  disclosure?: "SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION";
}

export interface FacialVerificationProvider {
  /**
   * capturedImageRef is a storage reference (Phase 4 concern), not raw image
   * bytes — this interface doesn't handle capture, only verification against
   * an already-captured/stored image.
   */
  verifyDriver(driverId: string, capturedImageRef: string): Promise<FacialVerificationOutcome>;
}
