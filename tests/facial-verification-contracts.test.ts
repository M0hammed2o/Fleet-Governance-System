import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_BIOMETRIC_LABEL,
  type VerificationRequest,
} from "@/lib/facial-verification/contracts";
import {
  BIOMETRIC_SIMULATOR_SCENARIOS,
  BiometricSimulatorEnvironmentError,
  DeterministicBiometricSimulator,
} from "@/lib/facial-verification/simulator";
import { buildFacialVerificationReadinessReport } from "@/lib/operations/facial-verification-readiness";

const now = () => new Date("2026-08-14T00:00:00.000Z");
const artifact = {
  opaqueReference: "private://synthetic/capture-1",
  sha256: "a".repeat(64),
  mimeType: "image/jpeg" as const,
  byteLength: 1024,
};

function request(overrides: Partial<VerificationRequest> = {}): VerificationRequest {
  return {
    tenantId: "tenant-a",
    templateTenantId: "tenant-a",
    driverId: "synthetic-driver-a",
    providerTemplateReference: "synthetic-template-a",
    requestId: "request-a",
    idempotencyKey: "idempotency-a",
    artifact,
    decisionThreshold: 0.8,
    ...overrides,
  };
}

describe("Phase 17A provider-neutral biometric simulator", () => {
  it("covers every mandated deterministic scenario without network access", () => {
    expect(BIOMETRIC_SIMULATOR_SCENARIOS).toHaveLength(25);
    expect(BIOMETRIC_SIMULATOR_SCENARIOS).toEqual(
      expect.arrayContaining([
        "SUCCESS",
        "NON_MATCH",
        "INDETERMINATE",
        "PHOTO_REPLAY_ATTACK",
        "VIDEO_REPLAY_ATTACK",
        "PROVIDER_TIMEOUT",
        "PROVIDER_OUTAGE",
        "DUPLICATE_REQUEST",
        "CROSS_TENANT_TEMPLATE",
        "THRESHOLD_BOUNDARY",
        "MANUAL_FALLBACK",
      ]),
    );
  });

  it.each([
    ["SUCCESS", "VERIFIED"],
    ["NON_MATCH", "NOT_VERIFIED"],
    ["INDETERMINATE", "INDETERMINATE"],
    ["LIVENESS_FAILURE", "LIVENESS_FAILED"],
    ["PROVIDER_TIMEOUT", "UNAVAILABLE"],
    ["REVOKED_ENROLMENT", "NOT_ENROLLED"],
    ["MANUAL_FALLBACK", "MANUAL_FALLBACK_REQUIRED"],
  ] as const)("maps %s to %s with synthetic provenance", async (scenario, decision) => {
    const simulator = new DeterministicBiometricSimulator(
      scenario,
      { APP_ENV: "test" },
      now,
    );
    const outcome = await simulator.verify(request());
    expect(outcome.decision).toBe(decision);
    expect(outcome.provenance).toMatchObject({
      synthetic: true,
      disclosure: SYNTHETIC_BIOMETRIC_LABEL,
    });
  });

  it("rejects cross-tenant template references before any possible match", async () => {
    const simulator = new DeterministicBiometricSimulator(
      "SUCCESS",
      { APP_ENV: "test" },
      now,
    );
    const outcome = await simulator.verify(
      request({ templateTenantId: "tenant-b" }),
    );
    expect(outcome).toMatchObject({
      decision: "INDETERMINATE",
      reasonCode: "CROSS_TENANT_REFERENCE",
    });
  });

  it("returns the cached decision for duplicate idempotency keys", async () => {
    const simulator = new DeterministicBiometricSimulator(
      "SUCCESS",
      { APP_ENV: "test" },
      now,
    );
    const first = await simulator.verify(request());
    const duplicate = await simulator.verify(request({ requestId: "request-b" }));
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.decision).toBe(first.decision);
  });

  it("refuses production and fail-closed staging, while permitting explicitly isolated test-only staging", () => {
    expect(
      () => new DeterministicBiometricSimulator("SUCCESS", { APP_ENV: "production" }),
    ).toThrow(BiometricSimulatorEnvironmentError);
    expect(
      () => new DeterministicBiometricSimulator("SUCCESS", { APP_ENV: "staging" }),
    ).toThrow(BiometricSimulatorEnvironmentError);
    expect(
      () =>
        new DeterministicBiometricSimulator("SUCCESS", {
          APP_ENV: "staging",
          BIOMETRIC_SIMULATOR_APPROVED_TEST_ONLY: "true",
          BIOMETRIC_SIMULATOR_ISOLATED: "true",
        }),
    ).not.toThrow();
  });
});

describe("Phase 17A production facial-verification activation guard", () => {
  it("lists every mandatory blocker and rejects the simulator", () => {
    const report = buildFacialVerificationReadinessReport({
      APP_ENV: "production",
      FACIAL_VERIFICATION_PROVIDER: "simulator",
    });
    expect(report.activationReady).toBe(false);
    expect(report.simulatorSelected).toBe(true);
    expect(report.items).toHaveLength(17);
    expect(report.items.filter((item) => !item.ready).length).toBeGreaterThan(1);
  });

  it("can become ready only when a non-simulator provider and every approval are explicit", () => {
    const input: Record<string, string> = {
      APP_ENV: "production",
      FACIAL_VERIFICATION_PROVIDER: "approved-provider-adapter",
    };
    for (const variable of [
      "FACIAL_PROVIDER_APPROVED",
      "FACIAL_PROVIDER_DPA_EXECUTED",
      "FACIAL_POPIA_DECISION_APPROVED",
      "FACIAL_INFORMATION_OFFICER_APPROVED",
      "FACIAL_RETENTION_APPROVED",
      "FACIAL_THRESHOLDS_APPROVED",
      "FACIAL_BIAS_PERFORMANCE_TESTED",
      "FACIAL_CUSTOMER_AUTHORIZED",
      "FACIAL_DRIVER_AUTHORITY_APPROVED",
      "FACIAL_PRODUCTION_CREDENTIALS_CONFIGURED",
      "FACIAL_ENCRYPTION_KEYS_CONFIGURED",
      "FACIAL_INCIDENT_PROCEDURE_APPROVED",
      "FACIAL_PHYSICAL_DEVICE_TESTED",
      "FACIAL_HUMAN_UAT_APPROVED",
      "FACIAL_OPERATIONAL_OWNER_NAMED",
    ]) input[variable] = "true";
    expect(buildFacialVerificationReadinessReport(input).activationReady).toBe(true);
  });
});
