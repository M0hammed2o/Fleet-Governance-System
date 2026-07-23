import type { FacialVerificationOutcome, FacialVerificationProvider } from "@/lib/facial-verification/provider";

/**
 * Deterministic dev/test provider — no real biometric matching. Behaviour is
 * driven entirely by a `force:<outcome>` marker in capturedImageRef so tests
 * and manual QA can exercise every result without needing real images:
 *   "force:not_verified", "force:liveness_failed", "force:unavailable",
 *   "force:fallback". Anything else (including a normal-looking reference)
 * returns VERIFIED.
 */
export class MockFacialVerificationProvider implements FacialVerificationProvider {
  async verifyDriver(driverId: string, capturedImageRef: string): Promise<FacialVerificationOutcome> {
    const verifiedAt = new Date();
    const providerReference = `mock-${driverId}-${verifiedAt.getTime()}`;

    if (capturedImageRef.includes("force:not_verified")) {
      return { result: "NOT_VERIFIED", providerReference, verifiedAt, failureReason: "Face did not match enrolled reference." };
    }
    if (capturedImageRef.includes("force:liveness_failed")) {
      return { result: "LIVENESS_FAILED", providerReference, verifiedAt, failureReason: "Liveness check failed." };
    }
    if (capturedImageRef.includes("force:unavailable")) {
      return { result: "PROVIDER_UNAVAILABLE", providerReference, verifiedAt, failureReason: "Mock provider forced unavailability." };
    }
    if (capturedImageRef.includes("force:fallback")) {
      return { result: "MANUAL_FALLBACK_REQUIRED", providerReference, verifiedAt, failureReason: "Automated verification inconclusive." };
    }

    return { result: "VERIFIED", providerReference, confidence: 0.97, verifiedAt };
  }
}
