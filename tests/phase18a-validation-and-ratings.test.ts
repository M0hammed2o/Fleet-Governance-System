import { describe, expect, it } from "vitest";
import { demoSelfServiceEnabled, validateRuntimeConfiguration } from "@/lib/config/runtime-config-core";
import { demoRegistrationSchema, onboardingUpdateSchema } from "@/lib/validation/demo";
import { createDriverSchema } from "@/lib/validation/driver";
import { createVehicleSchema } from "@/lib/validation/vehicle";
import { calculateDriverGovernanceRating } from "@/lib/ratings/driver-rating";

const now = new Date("2026-08-17T00:00:00.000Z");
const healthy = {
  employeeNumber: "SYN-001", contactPhone: "+27000000000", contactEmail: null, licenceNumber: "SYN-LIC",
  licenceExpiry: new Date("2028-01-01"), pdpStatus: "VALID", pdpExpiry: new Date("2028-01-01"), hasCurrentVehicle: true,
  openCriticalExceptions: 0, openHighExceptions: 0, failedInspections: 0, deniedGateEvents: 0, openDiscrepancies: 0, seriousGovernanceIndicators: 0,
};

describe("Phase 18A environment and input controls", () => {
  it("enables registration only for explicit development or approved staging and always rejects production", () => {
    expect(demoSelfServiceEnabled({ APP_ENV: "development", DEMO_SELF_SERVICE_ENABLED: "true" })).toBe(true);
    expect(demoSelfServiceEnabled({ APP_ENV: "development" })).toBe(false);
    expect(demoSelfServiceEnabled({ APP_ENV: "staging", DEMO_SELF_SERVICE_ENABLED: "true" })).toBe(false);
    expect(demoSelfServiceEnabled({ APP_ENV: "staging", DEMO_SELF_SERVICE_ENABLED: "true", DEMO_ENVIRONMENT_APPROVED: "true" })).toBe(true);
    expect(demoSelfServiceEnabled({ APP_ENV: "production", DEMO_SELF_SERVICE_ENABLED: "true", DEMO_ENVIRONMENT_APPROVED: "true" })).toBe(false);
    expect(demoSelfServiceEnabled({ NODE_ENV: "production", DEMO_SELF_SERVICE_ENABLED: "true", DEMO_ENVIRONMENT_APPROVED: "true" })).toBe(false);
    expect(validateRuntimeConfiguration({ APP_ENV: "production", DEMO_SELF_SERVICE_ENABLED: "true" }).issues.some((issue) => issue.variable === "DEMO_SELF_SERVICE_ENABLED")).toBe(true);
  });

  it("requires explicit demo terms, synthetic disclosure and the established strong password policy", () => {
    const base = { companyName: "Synthetic Company", workspaceSlug: "synthetic-company", administratorName: "Demo Admin", email: "admin@example.test", password: "StrongSynthetic!123" };
    expect(demoRegistrationSchema.safeParse(base).success).toBe(false);
    expect(demoRegistrationSchema.safeParse({ ...base, acceptDemoTerms: true, acceptSyntheticDisclosure: true }).success).toBe(true);
  });

  it("reconciles category counts exactly to the declared fleet size", () => {
    expect(onboardingUpdateSchema.safeParse({ fleet: { declaredFleetSize: 3, fleetComposition: { TRUCK: 2, VAN: 1 } } }).success).toBe(true);
    expect(onboardingUpdateSchema.safeParse({ fleet: { declaredFleetSize: 4, fleetComposition: { TRUCK: 2, VAN: 1 } } }).success).toBe(false);
  });

  it("applies category-specific vehicle validation without requiring truck fields elsewhere", () => {
    expect(createVehicleSchema.safeParse({ registrationNumber: "SYN-1", category: "TRUCK" }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ registrationNumber: "SYN-1", category: "TRUCK", carryingCapacityTonnes: 18 }).success).toBe(true);
    expect(createVehicleSchema.safeParse({ registrationNumber: "SYN-2", category: "PASSENGER" }).success).toBe(true);
    expect(createVehicleSchema.safeParse({ registrationNumber: "SYN-3", category: "SALES_REPRESENTATIVE" }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ registrationNumber: "SYN-3", category: "SALES_REPRESENTATIVE", department: "Synthetic Sales" }).success).toBe(true);
  });

  it("rejects inverted licence chronology and incomplete professional permits", () => {
    expect(createDriverSchema.safeParse({ name: "Synthetic Driver", licenceIssueDate: "2027-01-01", licenceExpiry: "2026-01-01" }).success).toBe(false);
    expect(createDriverSchema.safeParse({ name: "Synthetic Driver", pdpStatus: "VALID" }).success).toBe(false);
    expect(createDriverSchema.safeParse({ name: "Synthetic Driver", pdpStatus: "NOT_REQUIRED" }).success).toBe(true);
  });
});

describe("versioned explainable driver governance rating", () => {
  it("produces deterministic green, yellow and red examples with explanations and actions", () => {
    const green = calculateDriverGovernanceRating(healthy, now);
    const yellow = calculateDriverGovernanceRating({ ...healthy, licenceExpiry: new Date("2026-08-25"), pdpExpiry: new Date("2026-08-30") }, now);
    const red = calculateDriverGovernanceRating({ ...healthy, employeeNumber: null, contactPhone: null, licenceExpiry: new Date("2026-07-01"), pdpStatus: "EXPIRED", pdpExpiry: new Date("2026-06-01"), hasCurrentVehicle: false, openHighExceptions: 1, failedInspections: 1, deniedGateEvents: 1 }, now);
    expect(green).toMatchObject({ score: 100, status: "GOOD_STANDING", ruleVersion: "phase18a-driver-governance-v1" });
    expect(yellow.status).toBe("REVIEW_REQUIRED");
    expect(red.status).toBe("SERIOUS_ATTENTION");
    expect(red.actionsRequired.length).toBeGreaterThan(3);
    expect(red.disclaimer).toMatch(/not a finding of fraud/i);
    expect(red.factors.every((factor) => factor.code && factor.label)).toBe(true);
  });
});
