/**
 * Cloud liveness fallback boundary (Phase 9F). No AWS/Azure/GCP or other
 * paid biometric-liveness vendor account exists or has been created — see
 * FACIAL_VERIFICATION_LICENSING.md "No paid/cloud account created." Same
 * "interface + dev mock, real vendor deferred" pattern as
 * FacialVerificationProvider/TelematicsProvider/ObjectStorageProvider.
 *
 * Intended trigger conditions (not all wired to an automatic policy yet —
 * see lib/repositories/cloud-fallback-repository.ts for which ones are):
 *   - a suspicious/borderline on-device result (REVIEW_REQUIRED)
 *   - repeated on-device liveness failures for the same attempt sequence
 *   - a high-risk tenant's own configured policy requires it
 *   - random sampling for quality assurance
 *   - a supervisor explicitly requests re-verification
 */

export type CloudLivenessResult = "LIVE" | "NOT_LIVE" | "INCONCLUSIVE" | "PROVIDER_UNAVAILABLE";

export interface CloudLivenessOutcome {
  result: CloudLivenessResult;
  providerReference: string;
  confidence?: number;
  checkedAt: Date;
  failureReason?: string;
}

export interface CloudLivenessRequest {
  tenantId: string;
  driverId: string;
  /** A short sequence of frame descriptors/signals, never raw video — see components/liveness-challenge.tsx. */
  frameCount: number;
  reason: "REVIEW_REQUIRED" | "REPEATED_FAILURE" | "HIGH_RISK_POLICY" | "RANDOM_SAMPLE" | "SUPERVISOR_REQUESTED";
}

export interface CloudLivenessProvider {
  checkLiveness(request: CloudLivenessRequest): Promise<CloudLivenessOutcome>;
}

/** No cloud vendor configured — every call is honestly PROVIDER_UNAVAILABLE, never a fabricated result. */
export class NoOpCloudLivenessProvider implements CloudLivenessProvider {
  async checkLiveness(request: CloudLivenessRequest): Promise<CloudLivenessOutcome> {
    return {
      result: "PROVIDER_UNAVAILABLE",
      providerReference: `noop-${request.tenantId}-${Date.now()}`,
      checkedAt: new Date(),
      failureReason: "No cloud liveness vendor is configured — see FACIAL_VERIFICATION_LICENSING.md.",
    };
  }
}

/**
 * Deterministic dev/test provider — no real cloud call, same "force:<outcome>"
 * marker convention as MockFacialVerificationProvider, driven by `reason`
 * plus an optional forced outcome for tests.
 */
export class MockCloudLivenessProvider implements CloudLivenessProvider {
  constructor(private readonly forcedResult: CloudLivenessResult = "LIVE") {}

  async checkLiveness(request: CloudLivenessRequest): Promise<CloudLivenessOutcome> {
    const checkedAt = new Date();
    const providerReference = `mock-cloud-${request.tenantId}-${checkedAt.getTime()}`;
    if (this.forcedResult === "NOT_LIVE") {
      return { result: "NOT_LIVE", providerReference, checkedAt, confidence: 0.2, failureReason: "Mock: spoof indicators detected." };
    }
    if (this.forcedResult === "INCONCLUSIVE") {
      return { result: "INCONCLUSIVE", providerReference, checkedAt, confidence: 0.5 };
    }
    if (this.forcedResult === "PROVIDER_UNAVAILABLE") {
      return { result: "PROVIDER_UNAVAILABLE", providerReference, checkedAt, failureReason: "Mock: forced unavailability." };
    }
    return { result: "LIVE", providerReference, checkedAt, confidence: 0.96 };
  }
}
