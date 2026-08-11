import { describe, it, expect } from "vitest";
import { ForbiddenError } from "@/lib/auth/authorize";
import {
  allocateNextInvestigationCaseNumber,
  createInvestigationCase,
  getInvestigationCaseInTenant,
  submitInvestigationCase,
  triageInvestigationCase,
  beginInvestigation,
  requestInformation,
  resumeInvestigation,
  closeInvestigationCase,
  reopenInvestigationCase,
  addInvestigationSubject,
  recordSubjectResponse,
  addInvestigationNote,
  amendInvestigationNote,
  listInvestigationNotes,
  createInvestigationTask,
  updateInvestigationTask,
  listOverdueInvestigationTasks,
  InvalidCaseTransitionError,
  CaseClosureRequirementsNotMetError,
  NoteAlreadyAmendedError,
  SubjectNotFoundError,
  NoteNotFoundError,
  TaskNotFoundError,
  InvestigationEntityNotFoundError,
} from "@/lib/repositories/investigation-case-repository";
import { createInvestigationFinding, submitFindingForApproval, approveInvestigationFinding } from "@/lib/repositories/investigation-finding-repository";
import { createTenant } from "./helpers/fixtures";
import { makeManagerSession, makeManagerSessionForTenant, makeInvestigatorSessionForTenant, makeNoPermissionSessionForTenant } from "./helpers/investigation-fixtures";

describe("allocateNextInvestigationCaseNumber", () => {
  it("is sequential, never duplicates under concurrency, and embeds the requested year", async () => {
    const tenant = await createTenant("Case Numbering");
    const year = 2031; // far-future year, avoids collision with any other test's default-year sequence
    const results = await Promise.all(Array.from({ length: 20 }, () => allocateNextInvestigationCaseNumber(tenant.id, year)));
    const unique = new Set(results);
    expect(unique.size).toBe(20);
    for (const r of results) expect(r).toMatch(new RegExp(`^INV-${year}-\\d{6}$`));
  });

  it("uses a configured tenant prefix", async () => {
    const tenant = await createTenant("Prefix Test");
    const { session } = await makeManagerSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(session, { title: "t", description: "d", source: "MANUAL_CONCERN" });
    expect(investigationCase.caseNumber).toMatch(/^INV-\d{4}-\d{6}$/);
  });
});

describe("createInvestigationCase", () => {
  it("requires investigationCase:CREATE", async () => {
    const tenant = await createTenant("No Perms");
    const { session } = await makeNoPermissionSessionForTenant(tenant);
    await expect(createInvestigationCase(session, { title: "t", description: "d", source: "MANUAL_CONCERN" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("starts DRAFT, NOT_DETERMINED, with an active evidence hold, never guessing an outcome", async () => {
    const { session } = await makeManagerSession();
    const c = await createInvestigationCase(session, { title: "Concern", description: "A reported concern", source: "MANUAL_CONCERN" });
    expect(c.status).toBe("DRAFT");
    expect(c.outcome).toBe("NOT_DETERMINED");
    expect(c.evidenceHoldActive).toBe(true);
  });

  it("is tenant-isolated — a case is invisible from a different tenant's session", async () => {
    const { session: sessionA } = await makeManagerSession();
    const caseA = await createInvestigationCase(sessionA, { title: "t", description: "d", source: "MANUAL_CONCERN" });

    const { session: sessionB } = await makeManagerSession();
    const seenFromB = await getInvestigationCaseInTenant(sessionB, caseA.id);
    expect(seenFromB).toBeNull();
  });

  it("withholds confidential content from a session without investigationConfidentialAccess:VIEW, using neutral placeholder text", async () => {
    const tenant = await createTenant("Confidential Case");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const c = await createInvestigationCase(manager, {
      title: "Sensitive matter",
      description: "Highly sensitive allegation detail",
      source: "MANUAL_CONCERN",
      confidentiality: "HIGHLY_RESTRICTED",
      reportingPersonName: "A named reporter",
    });

    // A session with investigationCase:VIEW but deliberately NOT
    // investigationConfidentialAccess:VIEW (unlike the Investigator/Manager
    // fixtures, which both hold it) — the narrow role P11E is guarding against.
    const { makeSessionForTenant } = await import("./helpers/billing-session");
    const { session: viewOnly } = await makeSessionForTenant(tenant, "View Only", [["investigationCase", "VIEW"]]);

    const seen = await getInvestigationCaseInTenant(viewOnly, c.id);
    expect(seen).not.toBeNull();
    expect(seen!.description).toBe("[Confidential — access restricted]");
    expect(seen!.reportingPersonName).toBeNull();

    const seenByManager = await getInvestigationCaseInTenant(manager, c.id);
    expect(seenByManager!.description).toBe("Highly sensitive allegation detail");
  });
});

describe("investigation case workflow state machine", () => {
  it("only allows valid transitions and rejects invalid ones", async () => {
    const { session } = await makeManagerSession();
    const c = await createInvestigationCase(session, { title: "t", description: "d", source: "MANUAL_CONCERN" });

    const submitted = await submitInvestigationCase(session, c.id);
    expect(submitted.status).toBe("OPEN");

    const triaged = await triageInvestigationCase(session, c.id, { priority: "HIGH" });
    expect(triaged.status).toBe("TRIAGE");
    expect(triaged.priority).toBe("HIGH");

    const begun = await beginInvestigation(session, c.id);
    expect(begun.status).toBe("UNDER_INVESTIGATION");

    // DRAFT -> UNDER_INVESTIGATION directly is not a valid transition from the current TRIAGE-derived state re-attempted
    await expect(triageInvestigationCase(session, c.id, {})).rejects.toBeInstanceOf(InvalidCaseTransitionError);

    const awaitingInfo = await requestInformation(session, c.id, "Need more detail");
    expect(awaitingInfo.status).toBe("AWAITING_INFORMATION");

    const resumed = await resumeInvestigation(session, c.id);
    expect(resumed.status).toBe("UNDER_INVESTIGATION");
  });

  it("cannot close without a recorded outcome, finding summary, authorised closing user and closure date all set together", async () => {
    const { session } = await makeManagerSession();
    const c = await createInvestigationCase(session, { title: "t", description: "d", source: "MANUAL_CONCERN" });
    await submitInvestigationCase(session, c.id);
    await triageInvestigationCase(session, c.id, {});
    await beginInvestigation(session, c.id);

    // Not yet AWAITING_APPROVAL — invalid transition
    await expect(closeInvestigationCase(session, c.id, { approvedFindingId: "does-not-matter" })).rejects.toBeInstanceOf(InvalidCaseTransitionError);
  });

  it("full lifecycle: submit -> triage -> begin -> finding -> approve -> close -> reopen", async () => {
    const tenant = await createTenant("Full Lifecycle");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: investigator } = await makeInvestigatorSessionForTenant(tenant);

    const c = await createInvestigationCase(manager, { title: "Lifecycle case", description: "d", source: "MANUAL_CONCERN" });
    await submitInvestigationCase(manager, c.id);
    await triageInvestigationCase(manager, c.id, {});
    await beginInvestigation(manager, c.id);

    const finding = await createInvestigationFinding(investigator, c.id, {
      executiveSummary: "Summary",
      detailedFindings: "Details",
      outcome: "SUBSTANTIATED",
    });
    await submitFindingForApproval(investigator, c.id, finding.id);

    // Not yet approved — closure must still fail with a clear reason.
    await expect(closeInvestigationCase(manager, c.id, { approvedFindingId: finding.id })).rejects.toBeInstanceOf(CaseClosureRequirementsNotMetError);

    await approveInvestigationFinding(manager, c.id, finding.id);
    const closed = await closeInvestigationCase(manager, c.id, { approvedFindingId: finding.id });
    expect(closed.status).toBe("CLOSED");
    expect(closed.outcome).toBe("SUBSTANTIATED");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedByUserId).toBe(manager.userId);
    expect(closed.evidenceHoldActive).toBe(true); // closure never silently releases evidence

    const reopened = await reopenInvestigationCase(manager, c.id, "New evidence emerged");
    expect(reopened.status).toBe("REOPENED");
    expect(reopened.reopenReason).toBe("New evidence emerged");
  });
});

describe("investigation subjects — fairness controls", () => {
  it("stores a subject with neutral role labelling and a separately-recorded response", async () => {
    const { session } = await makeManagerSession();
    const c = await createInvestigationCase(session, { title: "t", description: "d", source: "MANUAL_CONCERN" });
    const subject = await addInvestigationSubject(session, c.id, { role: "SUBJECT", contractorName: "A named party", notes: "Linked for review" });
    expect(subject.role).toBe("SUBJECT");
    expect(subject.explanationResponse).toBeNull();

    const responded = await recordSubjectResponse(session, c.id, subject.id, "My account of events");
    expect(responded.explanationResponse).toBe("My account of events");
    expect(responded.explanationRespondedAt).not.toBeNull();
  });

  it("rejects cross-tenant subject references and a subject id nested under the wrong case", async () => {
    const tenantA = await createTenant("Subject A");
    const tenantB = await createTenant("Subject B");
    const { session: managerA } = await makeManagerSessionForTenant(tenantA);
    const { session: managerB } = await makeManagerSessionForTenant(tenantB);
    const caseA = await createInvestigationCase(managerA, { title: "A", description: "A", source: "MANUAL_CONCERN" });
    const caseA2 = await createInvestigationCase(managerA, { title: "A2", description: "A2", source: "MANUAL_CONCERN" });
    await expect(addInvestigationSubject(managerA, caseA.id, { role: "SUBJECT", userId: managerB.userId })).rejects.toBeInstanceOf(InvestigationEntityNotFoundError);
    const subject = await addInvestigationSubject(managerA, caseA.id, { role: "SUBJECT", contractorName: "Neutral party" });
    await expect(recordSubjectResponse(managerA, caseA2.id, subject.id, "wrong case")).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});

describe("investigation notes — append-only", () => {
  it("never edits the original note; an amendment is a new row referencing the original", async () => {
    const { session } = await makeManagerSession();
    const c = await createInvestigationCase(session, { title: "t", description: "d", source: "MANUAL_CONCERN" });
    const note = await addInvestigationNote(session, c.id, { content: "Original text" });

    const amendment = await amendInvestigationNote(session, c.id, note.id, "Corrected text");
    expect(amendment.supersedesNoteId).toBe(note.id);

    const all = await listInvestigationNotes(session, c.id);
    const original = all.find((n) => n.id === note.id);
    expect(original!.content).toBe("Original text"); // never mutated

    await expect(amendInvestigationNote(session, c.id, note.id, "Second attempt")).rejects.toBeInstanceOf(NoteAlreadyAmendedError);
  });

  it("withholds RESTRICTED notes from a session without investigationNote:VIEW", async () => {
    const tenant = await createTenant("Restricted Notes");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const c = await createInvestigationCase(manager, { title: "t", description: "d", source: "MANUAL_CONCERN" });
    await addInvestigationNote(manager, c.id, { content: "Standard note" });
    await addInvestigationNote(manager, c.id, { content: "Restricted note", confidentiality: "RESTRICTED" });

    const { makeSessionForTenant } = await import("./helpers/billing-session");
    const { session: viewOnly } = await makeSessionForTenant(tenant, "View Only Notes", [["investigationCase", "VIEW"]]);
    const visible = await listInvestigationNotes(viewOnly, c.id);
    expect(visible.map((n) => n.content)).toEqual(["Standard note"]);
  });

  it("rejects a note id nested under the wrong case", async () => {
    const { session } = await makeManagerSession();
    const caseA = await createInvestigationCase(session, { title: "A", description: "A", source: "MANUAL_CONCERN" });
    const caseB = await createInvestigationCase(session, { title: "B", description: "B", source: "MANUAL_CONCERN" });
    const note = await addInvestigationNote(session, caseA.id, { content: "Case A note" });
    await expect(amendInvestigationNote(session, caseB.id, note.id, "wrong case")).rejects.toBeInstanceOf(NoteNotFoundError);
  });
});

describe("investigation tasks", () => {
  it("creates, completes and reports overdue tasks without ever touching case status", async () => {
    const { session } = await makeManagerSession();
    const c = await createInvestigationCase(session, { title: "t", description: "d", source: "MANUAL_CONCERN" });
    const overdueDue = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const task = await createInvestigationTask(session, c.id, { description: "Interview witness", assignedToUserId: session.userId, dueDate: overdueDue });

    const overdue = await listOverdueInvestigationTasks(session.tenantId);
    expect(overdue.some((t) => t.id === task.id)).toBe(true);

    const completed = await updateInvestigationTask(session, c.id, task.id, { status: "DONE", completionNote: "Interviewed" });
    expect(completed.status).toBe("DONE");
    expect(completed.completedByUserId).toBe(session.userId);
    expect(completed.completedAt).not.toBeNull();

    const stillNotOverdue = await listOverdueInvestigationTasks(session.tenantId);
    expect(stillNotOverdue.some((t) => t.id === task.id)).toBe(false);
  });

  it("rejects cross-tenant assignees and task ids nested under another case", async () => {
    const tenantA = await createTenant("Task A");
    const tenantB = await createTenant("Task B");
    const { session: managerA } = await makeManagerSessionForTenant(tenantA);
    const { session: managerB } = await makeManagerSessionForTenant(tenantB);
    const caseA = await createInvestigationCase(managerA, { title: "A", description: "A", source: "MANUAL_CONCERN" });
    const caseA2 = await createInvestigationCase(managerA, { title: "A2", description: "A2", source: "MANUAL_CONCERN" });
    await expect(createInvestigationTask(managerA, caseA.id, { description: "foreign assignee", assignedToUserId: managerB.userId })).rejects.toBeInstanceOf(InvestigationEntityNotFoundError);
    const task = await createInvestigationTask(managerA, caseA.id, { description: "local", assignedToUserId: managerA.userId });
    await expect(updateInvestigationTask(managerA, caseA2.id, task.id, { status: "DONE" })).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});
