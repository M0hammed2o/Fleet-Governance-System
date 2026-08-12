import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createUatExecutionPack, exportUatExecutionCsv, validateUatExecutionPack, type UatRehearsalClassification } from "@/lib/pilot/uat-execution";
import { validateUatCatalogue } from "@/lib/pilot/uat-catalogue";

const catalogue = JSON.parse(fs.readFileSync("pilot/uat-catalogue.json", "utf8")) as unknown;
const classifications = JSON.parse(fs.readFileSync("pilot/uat-rehearsal-classifications.json", "utf8")) as UatRehearsalClassification[];

describe("human UAT execution pack", () => {
  it("initializes all 27 cases separately without fabricating a human result", () => {
    const pack = createUatExecutionPack(catalogue, classifications, new Date("2030-01-01T00:00:00Z"));
    expect(pack.executions).toHaveLength(27);
    expect(pack.executions.every((entry) => entry.events.length === 0)).toBe(true);
    expect(pack.notice).toMatch(/not human acceptance/i);
    expect(validateUatExecutionPack(pack, catalogue).valid).toBe(true);
  });

  it("rejects tampered catalogues and incomplete classification coverage", () => {
    expect(() => createUatExecutionPack(catalogue, classifications.slice(1))).toThrow(/mismatch/i);
    const pack = createUatExecutionPack(catalogue, classifications);
    const changed = structuredClone(catalogue) as Array<Record<string, unknown>>;
    changed[0].objective = "tampered";
    expect(validateUatExecutionPack(pack, changed).errors.join(" ")).toMatch(/digest/i);
  });

  it("requires tester role for results, approver role for sign-off and immutable final chronology", () => {
    const pack = createUatExecutionPack(catalogue, classifications);
    const events = pack.executions[0].events;
    events.push({ eventId: "UAT-EVENT-RESULT-001", occurredAt: "2030-01-02T10:00:00.000Z", actorDisplayName: "SYNTHETIC-UAT-TESTER", actorRole: "UAT_TESTER", action: "RESULT_RECORDED", environment: "LOCAL_SYNTHETIC", actualResult: "Observed the expected synthetic workflow.", result: "PASS", evidenceReference: "local:evidence/UAT-AUTH-001", defectReference: null, comments: null, signOffStatus: "PENDING" });
    events.push({ eventId: "UAT-EVENT-SIGNOFF-001", occurredAt: "2030-01-02T11:00:00.000Z", actorDisplayName: "SYNTHETIC-UAT-APPROVER", actorRole: "UAT_APPROVER", action: "SIGN_OFF_RECORDED", environment: "LOCAL_SYNTHETIC", actualResult: "Reviewed the recorded result and evidence.", result: "PASS", evidenceReference: "local:evidence/UAT-AUTH-001", defectReference: null, comments: null, signOffStatus: "ACCEPTED" });
    expect(validateUatExecutionPack(pack, catalogue).valid).toBe(true);
    events.push({ ...events[0], eventId: "UAT-EVENT-TAMPER-001", occurredAt: "2030-01-02T12:00:00.000Z" });
    expect(validateUatExecutionPack(pack, catalogue).errors.join(" ")).toMatch(/after final sign-off/i);
  });

  it("requires evidence for PASS, defects for FAIL and neutralizes CSV formulas", () => {
    const pack = createUatExecutionPack(catalogue, classifications);
    pack.executions[0].events.push({ eventId: "UAT-EVENT-FAIL-001", occurredAt: "2030-01-02T10:00:00.000Z", actorDisplayName: "=cmd", actorRole: "UAT_TESTER", action: "RESULT_RECORDED", environment: "LOCAL_SYNTHETIC", actualResult: "Failure observed.", result: "FAIL", evidenceReference: null, defectReference: null, comments: null, signOffStatus: "PENDING" });
    expect(validateUatExecutionPack(pack, catalogue).errors.join(" ")).toMatch(/FAIL requires a defect|FAIL requires an evidence/i);
    pack.executions[0].events[0].evidenceReference = "local:evidence";
    pack.executions[0].events[0].defectReference = "PILOT-DEF-003";
    const cases = validateUatCatalogue(catalogue).cases;
    expect(exportUatExecutionCsv(pack, cases)).toContain("\"'=cmd\"");
  });
});
