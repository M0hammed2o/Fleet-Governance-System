import type { FacialVerificationOutcome, FacialVerificationProvider } from "@/lib/facial-verification/provider";
import { SYNTHETIC_BIOMETRIC_LABEL } from "@/lib/facial-verification/contracts";
import { assertBiometricSimulatorAllowed } from "@/lib/facial-verification/simulator";

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
    assertBiometricSimulatorAllowed({
      APP_ENV: process.env.APP_ENV,
      BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY:
        process.env.BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY,
      BIOMETRIC_SIMULATOR_ISOLATED:
        process.env.BIOMETRIC_SIMULATOR_ISOLATED,
    });
    const verifiedAt = new Date();
    const providerReference = `mock-${driverId}-${verifiedAt.getTime()}`;

    if (capturedImageRef.includes("force:not_verified")) {
      return { result: "NOT_VERIFIED", providerReference, verifiedAt, failureReason: "Synthetic scenario: reference did not match.", synthetic: true, disclosure: SYNTHETIC_BIOMETRIC_LABEL };
    }
    if (capturedImageRef.includes("force:liveness_failed")) {
      return { result: "LIVENESS_FAILED", providerReference, verifiedAt, failureReason: "Synthetic scenario: facial liveness failed.", synthetic: true, disclosure: SYNTHETIC_BIOMETRIC_LABEL };
    }
    if (capturedImageRef.includes("force:unavailable")) {
      return { result: "PROVIDER_UNAVAILABLE", providerReference, verifiedAt, failureReason: "Synthetic scenario: provider unavailable.", synthetic: true, disclosure: SYNTHETIC_BIOMETRIC_LABEL };
    }
    if (capturedImageRef.includes("force:fallback")) {
      return { result: "MANUAL_FALLBACK_REQUIRED", providerReference, verifiedAt, failureReason: "Synthetic scenario: result indeterminate.", synthetic: true, disclosure: SYNTHETIC_BIOMETRIC_LABEL };
    }

    return { result: "VERIFIED", providerReference, confidence: 0.97, verifiedAt, synthetic: true, disclosure: SYNTHETIC_BIOMETRIC_LABEL };
  }
}
