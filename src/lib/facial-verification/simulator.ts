import {
  SYNTHETIC_BIOMETRIC_LABEL,
  type BiometricProviderErrorCode,
  type BiometricProviderProvenance,
  type EnrolmentQualityIssue,
  type EnrolmentQualityOutcome,
  type EnrolmentQualityRequest,
  type FacialVerificationDecision,
  type FacialVerificationProviderContract,
  type ProviderHealthOutcome,
  type TemplateCreationOutcome,
  type TemplateCreationRequest,
  type TemplateDeletionOutcome,
  type TemplateDeletionRequest,
  type VerificationOutcome,
  type VerificationRequest,
} from "@/lib/facial-verification/contracts";

export const BIOMETRIC_SIMULATOR_SCENARIOS = [
  "SUCCESS",
  "NON_MATCH",
  "INDETERMINATE",
  "POOR_LIGHTING",
  "BLURRED_IMAGE",
  "NO_FACE",
  "MULTIPLE_FACES",
  "FACE_TOO_SMALL",
  "FACE_PARTIALLY_OBSCURED",
  "UNSUPPORTED_FILE",
  "OVERSIZED_FILE",
  "PHOTO_REPLAY_ATTACK",
  "VIDEO_REPLAY_ATTACK",
  "LIVENESS_FAILURE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_OUTAGE",
  "RATE_LIMITING",
  "MALFORMED_RESPONSE",
  "DUPLICATE_REQUEST",
  "REVOKED_ENROLMENT",
  "EXPIRED_ENROLMENT",
  "CROSS_TENANT_TEMPLATE",
  "DELETED_DRIVER",
  "THRESHOLD_BOUNDARY",
  "MANUAL_FALLBACK",
] as const;
export type BiometricSimulatorScenario =
  (typeof BIOMETRIC_SIMULATOR_SCENARIOS)[number];

export interface BiometricSimulatorEnvironment {
  APP_ENV?: string;
  BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY?: string;
  BIOMETRIC_SIMULATOR_ISOLATED?: string;
}

export class BiometricSimulatorEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiometricSimulatorEnvironmentError";
  }
}

export function assertBiometricSimulatorAllowed(
  environment: BiometricSimulatorEnvironment,
): void {
  const appEnvironment = environment.APP_ENV ?? "development";
  if (appEnvironment === "production") {
    throw new BiometricSimulatorEnvironmentError(
      "Synthetic biometric simulation is forbidden in production.",
    );
  }
  if (
    appEnvironment === "staging" &&
    !(
      environment.BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY === "true" &&
      environment.BIOMETRIC_SIMULATOR_ISOLATED === "true"
    )
  ) {
    throw new BiometricSimulatorEnvironmentError(
      "Staging simulation requires explicit test-only approval and isolation.",
    );
  }
  if (!["development", "test", "staging"].includes(appEnvironment)) {
    throw new BiometricSimulatorEnvironmentError(
      "Synthetic biometric simulation requires an explicit non-production environment.",
    );
  }
}

const QUALITY_ISSUES: Partial<
  Record<BiometricSimulatorScenario, EnrolmentQualityIssue>
> = {
  POOR_LIGHTING: "POOR_LIGHTING",
  BLURRED_IMAGE: "BLURRED_IMAGE",
  NO_FACE: "NO_FACE",
  MULTIPLE_FACES: "MULTIPLE_FACES",
  FACE_TOO_SMALL: "FACE_TOO_SMALL",
  FACE_PARTIALLY_OBSCURED: "FACE_PARTIALLY_OBSCURED",
  UNSUPPORTED_FILE: "UNSUPPORTED_FILE",
  OVERSIZED_FILE: "OVERSIZED_FILE",
};

const ERROR_CODES: Partial<
  Record<BiometricSimulatorScenario, BiometricProviderErrorCode>
> = {
  UNSUPPORTED_FILE: "UNSUPPORTED_FILE",
  OVERSIZED_FILE: "OVERSIZED_FILE",
  POOR_LIGHTING: "POOR_QUALITY",
  BLURRED_IMAGE: "POOR_QUALITY",
  NO_FACE: "POOR_QUALITY",
  MULTIPLE_FACES: "POOR_QUALITY",
  FACE_TOO_SMALL: "POOR_QUALITY",
  FACE_PARTIALLY_OBSCURED: "POOR_QUALITY",
  PROVIDER_TIMEOUT: "TIMEOUT",
  PROVIDER_OUTAGE: "OUTAGE",
  RATE_LIMITING: "RATE_LIMITED",
  MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
  PHOTO_REPLAY_ATTACK: "REPLAY_DETECTED",
  VIDEO_REPLAY_ATTACK: "REPLAY_DETECTED",
  REVOKED_ENROLMENT: "ENROLMENT_REVOKED",
  EXPIRED_ENROLMENT: "ENROLMENT_EXPIRED",
  CROSS_TENANT_TEMPLATE: "CROSS_TENANT_REFERENCE",
  DELETED_DRIVER: "DRIVER_DELETED",
};

function decisionForScenario(
  scenario: BiometricSimulatorScenario,
): FacialVerificationDecision {
  if (scenario === "SUCCESS" || scenario === "DUPLICATE_REQUEST") return "VERIFIED";
  if (scenario === "NON_MATCH" || scenario === "THRESHOLD_BOUNDARY") {
    return "NOT_VERIFIED";
  }
  if (
    scenario === "PHOTO_REPLAY_ATTACK" ||
    scenario === "VIDEO_REPLAY_ATTACK" ||
    scenario === "LIVENESS_FAILURE"
  ) {
    return "LIVENESS_FAILED";
  }
  if (scenario === "MANUAL_FALLBACK") return "MANUAL_FALLBACK_REQUIRED";
  if (scenario === "REVOKED_ENROLMENT" || scenario === "EXPIRED_ENROLMENT") {
    return "NOT_ENROLLED";
  }
  if (
    scenario === "PROVIDER_TIMEOUT" ||
    scenario === "PROVIDER_OUTAGE" ||
    scenario === "RATE_LIMITING" ||
    scenario === "MALFORMED_RESPONSE"
  ) {
    return "UNAVAILABLE";
  }
  return "INDETERMINATE";
}

export class DeterministicBiometricSimulator
  implements FacialVerificationProviderContract
{
  readonly providerId = "genbridge-local-biometric-simulator";
  readonly providerVersion = "phase17a-v1";
  private readonly responses = new Map<string, VerificationOutcome>();

  constructor(
    private readonly scenario: BiometricSimulatorScenario,
    environment: BiometricSimulatorEnvironment = {
      APP_ENV: process.env.APP_ENV,
      BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY:
        process.env.BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY,
      BIOMETRIC_SIMULATOR_ISOLATED:
        process.env.BIOMETRIC_SIMULATOR_ISOLATED,
    },
    private readonly now: () => Date = () => new Date(),
  ) {
    assertBiometricSimulatorAllowed(environment);
  }

  private provenance(
    requestId: string,
    policyVersion = "synthetic-policy-v1",
  ): BiometricProviderProvenance {
    return {
      providerId: this.providerId,
      providerVersion: this.providerVersion,
      policyVersion,
      requestId,
      processedAt: this.now().toISOString(),
      synthetic: true,
      disclosure: SYNTHETIC_BIOMETRIC_LABEL,
    };
  }

  async assessEnrolmentQuality(
    request: EnrolmentQualityRequest,
  ): Promise<EnrolmentQualityOutcome> {
    const issue = QUALITY_ISSUES[this.scenario];
    return {
      accepted: !issue,
      score: issue ? 0.2 : 0.98,
      issues: issue ? [issue] : [],
      provenance: this.provenance(request.requestId),
    };
  }

  async createTemplate(
    request: TemplateCreationRequest,
  ): Promise<TemplateCreationOutcome> {
    return {
      providerTemplateReference: `synthetic-template:${request.tenantId}:${request.driverId}:v${request.templateVersion}`,
      expiresAt: null,
      provenance: this.provenance(request.requestId),
    };
  }

  async verify(request: VerificationRequest): Promise<VerificationOutcome> {
    const cached = this.responses.get(request.idempotencyKey);
    if (cached) return { ...cached, duplicate: true };

    const crossTenant = request.tenantId !== request.templateTenantId;
    const scenario = crossTenant ? "CROSS_TENANT_TEMPLATE" : this.scenario;
    const decision = decisionForScenario(scenario);
    const replay =
      scenario === "PHOTO_REPLAY_ATTACK"
        ? "PHOTO_REPLAY"
        : scenario === "VIDEO_REPLAY_ATTACK"
          ? "VIDEO_REPLAY"
          : null;
    const confidence =
      scenario === "SUCCESS" || scenario === "DUPLICATE_REQUEST"
        ? 0.97
        : scenario === "THRESHOLD_BOUNDARY"
          ? request.decisionThreshold
          : scenario === "NON_MATCH"
            ? 0.12
            : null;
    const outcome: VerificationOutcome = {
      decision,
      confidence,
      threshold: request.decisionThreshold,
      liveness: {
        decision:
          replay || scenario === "LIVENESS_FAILURE"
            ? "FAILED"
            : decision === "UNAVAILABLE"
              ? "NOT_PERFORMED"
              : "PASSED",
        confidence: replay || scenario === "LIVENESS_FAILURE" ? 0.08 : 0.96,
        attackType: replay,
      },
      reasonCode: ERROR_CODES[scenario] ?? null,
      duplicate: scenario === "DUPLICATE_REQUEST",
      provenance: this.provenance(request.requestId),
    };
    this.responses.set(request.idempotencyKey, outcome);
    return outcome;
  }

  async health(requestId: string): Promise<ProviderHealthOutcome> {
    void requestId;
    return {
      status: this.scenario === "PROVIDER_OUTAGE" ? "UNAVAILABLE" : "AVAILABLE",
      checkedAt: this.now().toISOString(),
      provenance: {
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        policyVersion: "synthetic-policy-v1",
        processedAt: this.now().toISOString(),
        synthetic: true,
        disclosure: SYNTHETIC_BIOMETRIC_LABEL,
      },
    };
  }

  async deleteTemplate(
    request: TemplateDeletionRequest,
  ): Promise<TemplateDeletionOutcome> {
    return {
      deleted: true,
      deletedAt: this.now().toISOString(),
      provenance: this.provenance(request.requestId),
    };
  }
}
