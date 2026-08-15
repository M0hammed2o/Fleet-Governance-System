export type PermissionKey = `${string}:${string}`;

export interface MobileTenant {
  id: string;
  name: string;
  slug: string;
}

export interface MobileSite {
  id: string;
  name: string;
  gates: Array<{
    id: string;
    name: string;
    direction: "ENTRY" | "EXIT" | "BOTH";
  }>;
}

export interface MobilePrincipal {
  userId: string;
  name: string;
  roleName: string;
  tenant: MobileTenant;
  permissions: PermissionKey[];
  sessionExpiresAt: string;
}

export interface MobileBootstrapResponse {
  principal: MobilePrincipal;
  sites: MobileSite[];
  capabilities: {
    guard: boolean;
    ownerOverview: boolean;
    approvals: boolean;
    investigations: boolean;
    confidentialInvestigations: boolean;
  };
  environment: {
    appEnv: string;
    syntheticOnly: boolean;
    pushEnabled: false;
    offlineMutations: false;
  };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type TrackerFreshness =
  | "LIVE"
  | "FRESH"
  | "STALE"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface TrackerSummary {
  source: string | null;
  freshness: TrackerFreshness;
  recordedAt: string | null;
  isSynthetic: boolean;
  mappingState: string | null;
  limitations: string[];
}

export interface GateQueueItem {
  id: string;
  referenceCode: string;
  status: string;
  direction: "ENTRY" | "EXIT";
  expectedAt: string | null;
  vehicle: {
    id: string;
    registrationNumber: string;
    fleetNumber: string | null;
  };
  driver: { id: string; name: string; employeeNumber: string | null };
  site: { id: string; name: string };
  authorization: { allowed: boolean; reason: string };
  tracker: TrackerSummary;
}

export interface MobileMovementDetail {
  id: string;
  referenceCode: string;
  status: string;
  movementType: string;
  purpose: string | null;
  destination: string | null;
  expectedDepartureAt: string | null;
  expectedReturnAt: string | null;
  approvedCargoSummary: string | null;
  vehicle: {
    id: string;
    registrationNumber: string;
    fleetNumber: string | null;
    status: string;
  };
  driver: {
    id: string;
    name: string;
    employeeNumber: string | null;
    status: string;
  };
  site: { id: string; name: string };
  approver: { name: string } | null;
  approvalComments: string | null;
}

export interface MobileNotification {
  id: string;
  category: string;
  severity: "INFO" | "WARNING" | "HIGH" | "CRITICAL";
  title: string;
  body: string;
  occurredAt: string;
  read: boolean;
  deepLink: string | null;
}

export interface OwnerOverview {
  counts: {
    vehiclesOut: number;
    overdue: number;
    awaitingApproval: number;
    openExceptions: number;
    highRiskIndicators: number;
  };
  tracker: {
    fresh: number;
    stale: number;
    unavailable: number;
    synthetic: number;
  };
  recentActivity: Array<{
    id: string;
    label: string;
    occurredAt: string;
    outcome: string;
  }>;
  recentReconciliations: Array<{
    id: string;
    referenceCode: string;
    status: string;
    createdAt: string;
  }>;
  investigationSummaries: Array<{
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    severity: string;
  }>;
}

export interface ApiFailureBody {
  error: string;
  code?: string;
  retryable?: boolean;
}

export const SYNTHETIC_BIOMETRIC_DISCLOSURE =
  "SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION" as const;

export type MobileBiometricScenario =
  | "SUCCESS"
  | "NON_MATCH"
  | "INDETERMINATE"
  | "LIVENESS_FAILURE"
  | "PROVIDER_OUTAGE"
  | "RATE_LIMITING";

export interface MobileFacialAttemptSummary {
  id: string;
  result:
    | "MATCH"
    | "NO_MATCH"
    | "REVIEW_REQUIRED"
    | "NOT_ENROLLED"
    | "CAPTURE_FAILED"
    | "LIVENESS_FAILED"
    | "PROVIDER_UNAVAILABLE";
  livenessResult: "PASSED" | "FAILED" | "NOT_REQUIRED" | "SKIPPED";
  safeErrorCode: string | null;
  attemptedAt: string;
  synthetic: true;
  disclosure: typeof SYNTHETIC_BIOMETRIC_DISCLOSURE;
  providerId: string;
  policyVersion: string;
}

export interface MobileManualFallbackSummary {
  id: string;
  gateEventId: string | null;
  driver: { id: string; name: string; employeeNumber: string | null };
  reason: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  requestedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  requestedAt: string;
  resolvedAt: string | null;
  selfApprovalBlocked: boolean;
}

export interface MobileFacialIdentityContext {
  disclosure: typeof SYNTHETIC_BIOMETRIC_DISCLOSURE;
  enrolment: {
    status: "ENROLLED" | "NOT_ENROLLED";
    version: number | null;
    synthetic: boolean | null;
  };
  latestAttempt: MobileFacialAttemptSummary | null;
  attemptsRemaining: number;
  rateLimit: { maximum: number; windowMinutes: number };
  fallback: MobileManualFallbackSummary | null;
  auditConfirmation: {
    recorded: true;
    action: string;
    recordedAt: string;
  } | null;
}
