import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/authorize";
import {
  addInvestigationNote,
  addInvestigationSubject,
  createInvestigationCase,
  getInvestigationCaseInTenant,
  getInvestigationDashboardCounts,
  listChronology,
  listInvestigationCasesInTenant,
  listInvestigationNotes,
  listInvestigationSubjects,
} from "@/lib/repositories/investigation-case-repository";
import { listEvidenceForCase } from "@/lib/repositories/investigation-evidence-repository";
import { listInvestigationFindings } from "@/lib/repositories/investigation-finding-repository";
import { listInvestigationReports } from "@/lib/repositories/investigation-report-repository";
import { createTenant } from "./helpers/fixtures";
import { makeSessionForTenant } from "./helpers/billing-session";
import { makeManagerSessionForTenant } from "./helpers/investigation-fixtures";

const ORDINARY_CASE_READER_PERMISSIONS: Array<[string, string]> = [
  ["investigationCase", "VIEW"],
  ["investigationCase", "EDIT"],
  ["investigationSubject", "EDIT"],
  ["investigationEvidence", "VIEW"],
  ["investigationEvidence", "EXPORT"],
  ["investigationNote", "VIEW"],
  ["investigationNote", "CREATE"],
  ["investigationFinding", "CREATE"],
  ["investigationReport", "EXPORT"],
];

describe("investigation confidentiality boundaries", () => {
  it("redacts confidential cases consistently across detail, list and dashboard responses", async () => {
    const tenant = await createTenant("Confidential response boundary");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: ordinary } = await makeSessionForTenant(tenant, "Ordinary case reader", ORDINARY_CASE_READER_PERMISSIONS);
    const secret = "whistleblower-sensitive-phrase";
    const investigationCase = await createInvestigationCase(manager, {
      title: secret,
      description: `${secret} allegation`,
      source: "FACIAL_VERIFICATION_FAILURE",
      category: "MISCONDUCT",
      priority: "CRITICAL",
      confidentiality: "RESTRICTED",
      reportingPersonName: `${secret} reporter`,
    });

    const detail = await getInvestigationCaseInTenant(ordinary, investigationCase.id);
    const list = await listInvestigationCasesInTenant(ordinary);
    const dashboard = await getInvestigationDashboardCounts(ordinary);

    for (const payload of [detail, list, dashboard]) {
      expect(JSON.stringify(payload)).not.toContain(secret);
      expect(JSON.stringify(payload)).not.toContain(manager.userId);
    }
    expect(detail).toMatchObject({ title: "[Confidential case]", category: null, outcome: "NOT_DETERMINED" });
    expect(await listInvestigationCasesInTenant(ordinary, { search: secret })).toHaveLength(0);
  });

  it("returns no confidential child narrative and blocks direct mutation paths", async () => {
    const tenant = await createTenant("Confidential child boundary");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: ordinary } = await makeSessionForTenant(tenant, "Ordinary child reader", ORDINARY_CASE_READER_PERMISSIONS);
    const investigationCase = await createInvestigationCase(manager, {
      title: "Restricted case",
      description: "Restricted narrative",
      source: "MANUAL_CONCERN",
      confidentiality: "HIGHLY_RESTRICTED",
    });
    await addInvestigationSubject(manager, investigationCase.id, { role: "WITNESS", contractorName: "Sensitive witness" });
    await addInvestigationNote(manager, investigationCase.id, { content: "Sensitive note", confidentiality: "RESTRICTED" });

    await expect(Promise.all([
      listInvestigationSubjects(ordinary, investigationCase.id),
      listInvestigationNotes(ordinary, investigationCase.id),
      listChronology(ordinary, investigationCase.id),
      listEvidenceForCase(ordinary, investigationCase.id),
      listInvestigationFindings(ordinary, investigationCase.id),
      listInvestigationReports(ordinary, investigationCase.id),
    ])).resolves.toEqual([[], [], [], [], [], []]);
    await expect(addInvestigationNote(ordinary, investigationCase.id, { content: "Unauthorized" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addInvestigationSubject(ordinary, investigationCase.id, { role: "OTHER_INVOLVED_PARTY", contractorName: "Unauthorized" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters restricted notes even when the containing case is standard", async () => {
    const tenant = await createTenant("Restricted note boundary");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: ordinary } = await makeSessionForTenant(tenant, "Ordinary note reader", ORDINARY_CASE_READER_PERMISSIONS);
    const investigationCase = await createInvestigationCase(manager, { title: "Standard", description: "Standard", source: "MANUAL_CONCERN" });
    await addInvestigationNote(manager, investigationCase.id, { content: "Visible note" });
    await addInvestigationNote(manager, investigationCase.id, { content: "Hidden note", confidentiality: "RESTRICTED" });

    const notes = await listInvestigationNotes(ordinary, investigationCase.id);
    expect(notes.map((note) => note.content)).toEqual(["Visible note"]);
  });
});
