import { describe, expect, it } from "vitest";
import { buildInternalPilotReadinessReport } from "@/lib/pilot/internal-pilot-readiness";

describe("internal pilot readiness", () => {
  it("fails closed when physical, human, defect, sign-off, or handover evidence is absent", () => {
    const report = buildInternalPilotReadinessReport({ environment: "development", catalogueCaseCount: 42, facialDisclosurePresent: true, trackerDisclosurePresent: true });
    expect(report.ready).toBe(false);
    expect(report.items.filter((item) => item.status === "BLOCKED").map((item) => item.id)).toEqual(expect.arrayContaining(["automated", "physical-android", "human-uat", "defects", "signoffs", "handover"]));
  });

  it("accepts only complete evidence for all mandatory customer-handover gates", () => {
    const approval = (name: string) => ({ name, approved: true, approvedAt: "2026-08-14T12:00:00.000Z" });
    const report = buildInternalPilotReadinessReport({
      environment: "staging-test-only",
      catalogueCaseCount: 42,
      automatedGate: { commit: "0123456789abcdef", passCount: 900, failedCount: 0, completedAt: "2026-08-14T12:00:00.000Z" },
      physicalAndroid: { manufacturer: "Test Manufacturer", model: "Test Device", androidVersion: "15", serialHash: "a".repeat(64), apkSha256: "b".repeat(64), passed: true, completedAt: "2026-08-14T12:00:00.000Z" },
      humanUat: { completedCases: 42, failedCases: 0, blockedCases: 0, coordinator: "Named Coordinator", completedAt: "2026-08-14T12:00:00.000Z" },
      defects: { criticalOpen: 0, highOpen: 0 },
      facialDisclosurePresent: true,
      trackerDisclosurePresent: true,
      signoffs: { technicalOwner: approval("Technical Owner"), businessOwner: approval("Business Owner"), securityPrivacyOwner: approval("Privacy Owner"), uatCoordinator: approval("UAT Coordinator"), internalPilotApprover: approval("Pilot Approver") },
      handoverAuthorizer: "Named Genbridge Authorizer",
    });
    expect(report.ready).toBe(true);
    expect(report.items.every((item) => item.status === "PASS")).toBe(true);
  });

  it("never permits production as an internal synthetic environment", () => {
    const report = buildInternalPilotReadinessReport({ environment: "production" });
    expect(report.items.find((item) => item.id === "environment")?.status).toBe("BLOCKED");
  });
});
