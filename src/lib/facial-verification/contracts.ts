export const SYNTHETIC_BIOMETRIC_LABEL =
  "SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION" as const;

export const FACIAL_VERIFICATION_DECISIONS = [
  "VERIFIED",
  "NOT_VERIFIED",
  "INDETERMINATE",
  "LIVENESS_FAILED",
  "UNAVAILABLE",
  "NOT_ENROLLED",
  "MANUAL_FALLBACK_REQUIRED",
] as const;
export type FacialVerificationDecision =
  (typeof FACIAL_VERIFICATION_DECISIONS)[number];

export const ENROLMENT_QUALITY_ISSUES = [
  "POOR_LIGHTING",
  "BLURRED_IMAGE",
  "NO_FACE",
  "MULTIPLE_FACES",
  "FACE_TOO_SMALL",
  "FACE_PARTIALLY_OBSCURED",
  "UNSUPPORTED_FILE",
  "OVERSIZED_FILE",
] as const;
export type EnrolmentQualityIssue = (typeof ENROLMENT_QUALITY_ISSUES)[number];

export const FACIAL_LIVENESS_DECISIONS = [
  "PASSED",
  "FAILED",
  "INDETERMINATE",
  "NOT_PERFORMED",
] as const;
export type FacialLivenessDecision =
  (typeof FACIAL_LIVENESS_DECISIONS)[number];

export const BIOMETRIC_PROVIDER_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNSUPPORTED_FILE",
  "OVERSIZED_FILE",
  "POOR_QUALITY",
  "RATE_LIMITED",
  "TIMEOUT",
  "OUTAGE",
  "MALFORMED_RESPONSE",
  "REPLAY_DETECTED",
  "ENROLMENT_REVOKED",
  "ENROLMENT_EXPIRED",
  "CROSS_TENANT_REFERENCE",
  "DRIVER_DELETED",
  "NOT_ENROLLED",
  "INTERNAL_ERROR",
] as const;
export type BiometricProviderErrorCode =
  (typeof BIOMETRIC_PROVIDER_ERROR_CODES)[number];

export interface BiometricProviderProvenance {
  providerId: string;
  providerVersion: string;
  policyVersion: string;
  requestId: string;
  processedAt: string;
  synthetic: boolean;
  disclosure?: typeof SYNTHETIC_BIOMETRIC_LABEL;
}

export interface PrivateBiometricArtifact {
  /** Private, short-lived opaque reference. Never a public URL or raw bytes. */
  opaqueReference: string;
  sha256: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
}

export interface EnrolmentQualityRequest {
  tenantId: string;
  driverId: string;
  requestId: string;
  artifact: PrivateBiometricArtifact;
}

export interface EnrolmentQualityOutcome {
  accepted: boolean;
  score: number | null;
  issues: EnrolmentQualityIssue[];
  provenance: BiometricProviderProvenance;
}

export interface TemplateCreationRequest extends EnrolmentQualityRequest {
  templateVersion: number;
  lawfulAuthority: "CONSENT" | "APPROVED_ALTERNATIVE";
  noticeVersion: string;
  retentionPolicyVersion: string;
}

export interface TemplateCreationOutcome {
  providerTemplateReference: string;
  expiresAt: string | null;
  provenance: BiometricProviderProvenance;
}

export interface VerificationRequest {
  tenantId: string;
  driverId: string;
  templateTenantId: string;
  providerTemplateReference: string;
  requestId: string;
  idempotencyKey: string;
  artifact: PrivateBiometricArtifact;
  decisionThreshold: number;
}

export interface FacialLivenessOutcome {
  decision: FacialLivenessDecision;
  confidence: number | null;
  attackType: "PHOTO_REPLAY" | "VIDEO_REPLAY" | null;
}

export interface VerificationOutcome {
  decision: FacialVerificationDecision;
  confidence: number | null;
  threshold: number;
  liveness: FacialLivenessOutcome;
  reasonCode: BiometricProviderErrorCode | null;
  duplicate: boolean;
  provenance: BiometricProviderProvenance;
}

export interface ProviderHealthOutcome {
  status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  checkedAt: string;
  provenance: Omit<BiometricProviderProvenance, "requestId">;
}

export interface TemplateDeletionRequest {
  tenantId: string;
  driverId: string;
  providerTemplateReference: string;
  requestId: string;
  reason: string;
}

export interface TemplateDeletionOutcome {
  deleted: boolean;
  deletedAt: string;
  provenance: BiometricProviderProvenance;
}

export class BiometricProviderError extends Error {
  constructor(
    public readonly code: BiometricProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BiometricProviderError";
  }
}

export interface FacialVerificationProviderContract {
  assessEnrolmentQuality(
    request: EnrolmentQualityRequest,
  ): Promise<EnrolmentQualityOutcome>;
  createTemplate(
    request: TemplateCreationRequest,
  ): Promise<TemplateCreationOutcome>;
  verify(request: VerificationRequest): Promise<VerificationOutcome>;
  health(requestId: string): Promise<ProviderHealthOutcome>;
  deleteTemplate(
    request: TemplateDeletionRequest,
  ): Promise<TemplateDeletionOutcome>;
}
