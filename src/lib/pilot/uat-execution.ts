import crypto from "node:crypto";
import { z } from "zod";
import { validateUatCatalogue, type UatCase } from "@/lib/pilot/uat-catalogue";

export const UAT_REHEARSAL_CLASSIFICATIONS = ["AUTOMATED_COVERAGE", "PARTIALLY_AUTOMATED", "MANUAL_VERIFICATION_REQUIRED", "BUSINESS_OWNER_DECISION_REQUIRED", "PROVIDER_DEPENDENT", "LEGAL_PRIVACY_DEPENDENT"] as const;

const eventSchema = z.object({
  eventId: z.string().regex(/^UAT-EVENT-[A-Z0-9-]+$/),
  occurredAt: z.string().datetime({ offset: true }),
  actorDisplayName: z.string().trim().min(1).max(120),
  actorRole: z.enum(["UAT_TESTER", "UAT_APPROVER"]),
  action: z.enum(["RESULT_RECORDED", "RETEST_RECORDED", "SIGN_OFF_RECORDED"]),
  environment: z.enum(["LOCAL_SYNTHETIC", "STAGING_SYNTHETIC"]),
  actualResult: z.string().trim().min(1).max(5000),
  result: z.enum(["PASS", "FAIL", "BLOCKED"]),
  evidenceReference: z.string().trim().max(500).nullable(),
  defectReference: z.string().trim().max(100).nullable(),
  comments: z.string().trim().max(2000).nullable(),
  signOffStatus: z.enum(["PENDING", "ACCEPTED", "CONDITIONALLY_ACCEPTED", "REJECTED"]),
});

const executionSchema = z.object({
  testCaseId: z.string(),
  classifications: z.array(z.enum(UAT_REHEARSAL_CLASSIFICATIONS)).min(1),
  automatedEvidence: z.array(z.string().trim().min(1).max(500)),
  events: z.array(eventSchema),
});

const packSchema = z.object({
  version: z.literal(1),
  catalogueSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
  notice: z.string().refine((value) => /not human acceptance/i.test(value), "Pack notice must distinguish rehearsal from human acceptance."),
  executions: z.array(executionSchema),
});

export type UatExecutionPack = z.infer<typeof packSchema>;

export interface UatRehearsalClassification {
  testCaseId: string;
  classifications: (typeof UAT_REHEARSAL_CLASSIFICATIONS)[number][];
  automatedEvidence: string[];
}

export function catalogueDigest(catalogue: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(catalogue)).digest("hex");
}

export function createUatExecutionPack(catalogueInput: unknown, classifications: UatRehearsalClassification[], now = new Date()): UatExecutionPack {
  const catalogue = validateUatCatalogue(catalogueInput);
  if (!catalogue.valid) throw new Error(catalogue.errors.join("\n"));
  const byId = new Map(classifications.map((entry) => [entry.testCaseId, entry]));
  const missing = catalogue.cases.filter((entry) => !byId.has(entry.id)).map((entry) => entry.id);
  const extra = classifications.filter((entry) => !catalogue.cases.some((testCase) => testCase.id === entry.testCaseId)).map((entry) => entry.testCaseId);
  if (missing.length || extra.length || byId.size !== classifications.length) throw new Error(`UAT rehearsal classification mismatch. Missing: ${missing.join(", ") || "none"}; extra/duplicate: ${extra.join(", ") || "none"}.`);
  return { version: 1, catalogueSha256: catalogueDigest(catalogueInput), createdAt: now.toISOString(), notice: "Automated rehearsal evidence is not human acceptance. All cases start without human results or sign-off.", executions: catalogue.cases.map((testCase) => ({ ...byId.get(testCase.id)!, events: [] })) };
}

export function validateUatExecutionPack(packInput: unknown, catalogueInput: unknown): { valid: boolean; errors: string[]; pack: UatExecutionPack | null } {
  const parsed = packSchema.safeParse(packInput);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`), pack: null };
  const catalogue = validateUatCatalogue(catalogueInput);
  if (!catalogue.valid) return { valid: false, errors: catalogue.errors, pack: null };
  const errors: string[] = [];
  if (parsed.data.catalogueSha256 !== catalogueDigest(catalogueInput)) errors.push("Execution pack does not match the canonical UAT catalogue digest.");
  const caseIds = new Set(catalogue.cases.map((entry) => entry.id));
  const executionIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const execution of parsed.data.executions) {
    if (!caseIds.has(execution.testCaseId)) errors.push(`Unknown test case ${execution.testCaseId}.`);
    if (executionIds.has(execution.testCaseId)) errors.push(`Duplicate execution ${execution.testCaseId}.`);
    executionIds.add(execution.testCaseId);
    let lastTime = -Infinity;
    let signedOff = false;
    for (const event of execution.events) {
      if (eventIds.has(event.eventId)) errors.push(`Duplicate event id ${event.eventId}.`);
      eventIds.add(event.eventId);
      const time = new Date(event.occurredAt).getTime();
      if (time < lastTime) errors.push(`${execution.testCaseId} events are not chronological.`);
      lastTime = time;
      if (signedOff) errors.push(`${execution.testCaseId} has an event after final sign-off; create a new reviewed pack revision instead.`);
      if (event.action === "SIGN_OFF_RECORDED") {
        if (event.actorRole !== "UAT_APPROVER") errors.push(`${execution.testCaseId} sign-off requires UAT_APPROVER.`);
        if (event.signOffStatus === "PENDING") errors.push(`${execution.testCaseId} sign-off cannot remain PENDING.`);
        signedOff = true;
      } else {
        if (event.actorRole !== "UAT_TESTER") errors.push(`${execution.testCaseId} test/retest recording requires UAT_TESTER.`);
        if (event.signOffStatus !== "PENDING") errors.push(`${execution.testCaseId} result events cannot claim sign-off.`);
      }
      if (event.result === "FAIL" && !event.defectReference) errors.push(`${execution.testCaseId} FAIL requires a defect reference.`);
      if ((event.result === "PASS" || event.result === "FAIL") && !event.evidenceReference) errors.push(`${execution.testCaseId} ${event.result} requires an evidence reference.`);
    }
  }
  for (const id of caseIds) if (!executionIds.has(id)) errors.push(`Execution pack is missing ${id}.`);
  return { valid: errors.length === 0, errors, pack: errors.length === 0 ? parsed.data : null };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportUatExecutionCsv(pack: UatExecutionPack, catalogue: UatCase[]): string {
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const rows = [["testCaseId", "module", "role", "classification", "eventId", "occurredAt", "tester", "environment", "actualResult", "result", "evidenceReference", "defectReference", "retest", "comments", "signOffStatus"]];
  for (const execution of pack.executions) {
    const testCase = byId.get(execution.testCaseId);
    if (execution.events.length === 0) rows.push([execution.testCaseId, testCase?.module ?? "", testCase?.role ?? "", execution.classifications.join("|"), "", "", "", "", "", "NOT_RUN", "", "", "", "", "PENDING"]);
    for (const event of execution.events) rows.push([execution.testCaseId, testCase?.module ?? "", testCase?.role ?? "", execution.classifications.join("|"), event.eventId, event.occurredAt, event.actorDisplayName, event.environment, event.actualResult, event.result, event.evidenceReference ?? "", event.defectReference ?? "", event.action === "RETEST_RECORDED" ? "YES" : "NO", event.comments ?? "", event.signOffStatus]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
