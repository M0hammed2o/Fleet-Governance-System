import { describe, expect, it } from "vitest";
import { validateUatCatalogue } from "@/lib/pilot/uat-catalogue";

const validCase = { id: "UAT-AUTH-001", module: "Authentication", objective: "Authenticate", role: "User", preconditions: "Seeded", testData: "Synthetic", steps: ["Sign in"], expectedResult: "Dashboard", actualResult: null, passFail: "NOT_RUN", evidence: null, defectReference: null, tester: null, date: null, retestStatus: "NOT_REQUIRED", approvalStatus: "PENDING" };

describe("UAT catalogue schema", () => {
  it("accepts complete, uniquely identified cases", () => expect(validateUatCatalogue([validCase])).toMatchObject({ valid: true, errors: [] }));
  it("rejects missing evidence fields and duplicate IDs", () => {
    const incomplete = { ...validCase } as Record<string, unknown>;
    delete incomplete.evidence;
    const result = validateUatCatalogue([validCase, incomplete]);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/missing evidence|Duplicate id/);
  });
});
