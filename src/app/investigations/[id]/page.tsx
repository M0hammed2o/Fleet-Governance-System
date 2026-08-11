"use client";

import { useEffect, useState, useCallback, use } from "react";

interface CaseDetail {
  id: string;
  caseNumber: string;
  title: string;
  description: string;
  status: string;
  outcome: string;
  priority: string;
  confidentiality: string;
  source: string;
  category: string | null;
  assignedInvestigatorUserId: string | null;
  caseOwnerUserId: string;
  evidenceHoldActive: boolean;
  closedAt: string | null;
  reopenReason: string | null;
}
interface Subject {
  id: string;
  role: string;
  notes: string | null;
  explanationResponse: string | null;
  contractorName: string | null;
  user: { id: string; name: string } | null;
  driver: { id: string; name: string } | null;
  vehicle: { id: string; registrationNumber: string } | null;
}
interface RelatedRecord {
  id: string;
  recordType: string;
  recordId: string;
  isReferralSource: boolean;
  snapshotSummary: unknown;
}
interface NoteItem {
  id: string;
  content: string;
  noteType: string;
  confidentiality: string;
  createdAt: string;
  supersedesNoteId: string | null;
  author: { name: string };
}
interface TaskItem {
  id: string;
  description: string;
  status: string;
  dueDate: string | null;
  completionNote: string | null;
  assignedTo: { name: string };
}
interface EvidenceItem {
  id: string;
  evidenceNumber: number;
  description: string;
  enteredInError: boolean;
  addedBy: { name: string };
  mediaAsset: { fileName: string; contentType: string };
}
interface Finding {
  id: string;
  version: number;
  status: string;
  outcome: string;
  executiveSummary: string;
  detailedFindings: string;
}
interface ChronologyEvent {
  id: string;
  eventType: string;
  description: string;
  occurredAt: string;
  actor: { name: string } | null;
}
interface ReportItem {
  id: string;
  fileName: string;
  createdAt: string;
}

async function postJson(url: string, body?: unknown, method: string = "POST") {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request to ${url} failed`);
  return data;
}

async function getJson(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return data;
}

export default function InvestigationCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [relatedRecords, setRelatedRecords] = useState<RelatedRecord[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [chronology, setChronology] = useState<ChronologyEvent[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [noteText, setNoteText] = useState("");
  const [noteConfidentiality, setNoteConfidentiality] = useState("STANDARD");
  const [subjectForm, setSubjectForm] = useState({ role: "SUBJECT", contractorName: "" });
  const [taskForm, setTaskForm] = useState({ description: "", assignedToUserId: "", dueDate: "" });
  const [findingForm, setFindingForm] = useState({ executiveSummary: "", detailedFindings: "", outcome: "NOT_DETERMINED" });
  const [evidenceForm, setEvidenceForm] = useState({ mediaAssetId: "", description: "" });
  const [evidenceUpload, setEvidenceUpload] = useState<{ file: File | null; description: string }>({ file: null, description: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [caseData, subjectsData, relatedData, notesData, tasksData, evidenceData, findingsData, chronologyData, reportsData] = await Promise.all([
        getJson(`/api/investigations/${id}`),
        getJson(`/api/investigations/${id}/subjects`),
        getJson(`/api/investigations/${id}/related-records`),
        getJson(`/api/investigations/${id}/notes`),
        getJson(`/api/investigations/${id}/tasks`),
        getJson(`/api/investigations/${id}/evidence`),
        getJson(`/api/investigations/${id}/findings`),
        getJson(`/api/investigations/${id}/chronology`),
        getJson(`/api/investigations/${id}/reports`),
      ]);
      if (!caseData) throw new Error("Case not found or you do not have access.");
      setCaseDetail(caseData.investigationCase);
      setSubjects(subjectsData?.subjects ?? []);
      setRelatedRecords(relatedData?.relatedRecords ?? []);
      setNotes(notesData?.notes ?? []);
      setTasks(tasksData?.tasks ?? []);
      setEvidence(evidenceData?.evidence ?? []);
      setFindings(findingsData?.findings ?? []);
      setChronology(chronologyData?.chronology ?? []);
      setReports(reportsData?.reports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load case");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  if (loading) return <main className="min-h-screen bg-slate-50 p-8 text-sm text-slate-400">Loading…</main>;
  if (!caseDetail) return <main className="min-h-screen bg-slate-50 p-8 text-sm text-red-700">{error ?? "Case not found."}</main>;

  const c = caseDetail;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-mono text-lg font-semibold text-slate-900">{c.caseNumber}</h1>
              <p className="text-sm text-slate-700">{c.title}</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>
                Status: <span className="font-semibold">{c.status.replaceAll("_", " ")}</span>
              </p>
              <p>
                Outcome: <span className="font-semibold">{c.outcome.replaceAll("_", " ")}</span>
              </p>
              <p>Priority: {c.priority}</p>
              {c.confidentiality !== "STANDARD" && <p className="text-amber-700">{c.confidentiality}</p>}
              {c.evidenceHoldActive && <p className="text-blue-700">Evidence hold ACTIVE</p>}
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">{c.description}</p>

          {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          {notice && <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {c.status === "DRAFT" && (
              <ActionButton onClick={() => run(() => postJson(`/api/investigations/${id}/submit`), "Submitted for triage.")}>Submit</ActionButton>
            )}
            {(c.status === "OPEN" || c.status === "DRAFT") && (
              <ActionButton onClick={() => run(() => postJson(`/api/investigations/${id}/triage`, {}), "Triaged.")}>Triage</ActionButton>
            )}
            {["OPEN", "TRIAGE", "REOPENED"].includes(c.status) && (
              <ActionButton onClick={() => run(() => postJson(`/api/investigations/${id}/begin`), "Investigation began.")}>Begin investigation</ActionButton>
            )}
            {c.status === "UNDER_INVESTIGATION" && (
              <ActionButton
                onClick={() => {
                  const reason = window.prompt("Reason for requesting information");
                  if (!reason) return;
                  run(() => postJson(`/api/investigations/${id}/request-information`, { reason }), "Information requested.");
                }}
              >
                Request information
              </ActionButton>
            )}
            {c.status === "AWAITING_INFORMATION" && (
              <ActionButton onClick={() => run(() => postJson(`/api/investigations/${id}/resume`), "Investigation resumed.")}>Resume</ActionButton>
            )}
            <ActionButton
              onClick={() => {
                const investigatorUserId = window.prompt("Investigator user id");
                if (!investigatorUserId) return;
                run(() => postJson(`/api/investigations/${id}/assign`, { investigatorUserId }), "Investigator assigned.");
              }}
            >
              Assign investigator
            </ActionButton>
            <ActionButton
              onClick={() => {
                const reason = window.prompt("Reason for escalating");
                if (!reason) return;
                run(() => postJson(`/api/investigations/${id}/escalate`, { priority: "HIGH", reason }), "Case escalated.");
              }}
            >
              Escalate
            </ActionButton>
            {c.status === "AWAITING_APPROVAL" && (
              <ActionButton
                onClick={() => {
                  const approved = findings.find((f) => f.status === "APPROVED");
                  if (!approved) {
                    setError("No approved finding exists yet — approve a finding before closing.");
                    return;
                  }
                  run(() => postJson(`/api/investigations/${id}/close`, { approvedFindingId: approved.id }), "Case closed.");
                }}
              >
                Close case
              </ActionButton>
            )}
            {c.status === "CLOSED" && (
              <ActionButton
                onClick={() => {
                  const reopenReason = window.prompt("Reason for reopening");
                  if (!reopenReason) return;
                  run(() => postJson(`/api/investigations/${id}/reopen`, { reopenReason }), "Case reopened.");
                }}
              >
                Reopen
              </ActionButton>
            )}
            {c.evidenceHoldActive && (
              <ActionButton
                onClick={() => {
                  const reason = window.prompt("Reason for releasing the evidence hold");
                  if (!reason) return;
                  run(async () => {
                    const result = await postJson(`/api/investigations/${id}/hold/release`, { reason });
                    if (result.requiresSecondApprover) {
                      setNotice("Release requested — a second, different authorised user must confirm for this high-severity case.");
                    }
                  }, "Hold release processed.");
                }}
              >
                Release evidence hold
              </ActionButton>
            )}
          </div>
        </div>

        <Section title="Subjects">
          <div className="mb-3 flex flex-wrap gap-2">
            <select
              aria-label="Subject role"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              value={subjectForm.role}
              onChange={(e) => setSubjectForm((form) => ({ ...form, role: e.target.value }))}
            >
              <option value="SUBJECT">Subject</option>
              <option value="WITNESS">Witness</option>
              <option value="OTHER_INVOLVED_PARTY">Other involved party</option>
            </select>
            <input
              aria-label="Subject or party name"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Subject or party name"
              value={subjectForm.contractorName}
              onChange={(e) => setSubjectForm((form) => ({ ...form, contractorName: e.target.value }))}
            />
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              disabled={!subjectForm.contractorName}
              onClick={() =>
                run(async () => {
                  await postJson(`/api/investigations/${id}/subjects`, subjectForm);
                  setSubjectForm({ role: "SUBJECT", contractorName: "" });
                }, "Case party added.")
              }
            >
              Add case party
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {subjects.length === 0 && <p className="text-slate-400">No subjects linked.</p>}
            {subjects.map((s) => (
              <li key={s.id} className="rounded border border-slate-100 p-2">
                <span className="font-semibold">{s.role}</span>: {s.user?.name ?? s.driver?.name ?? s.vehicle?.registrationNumber ?? s.contractorName ?? "Unnamed party"}
                {s.explanationResponse && <p className="mt-1 text-xs text-slate-600">Response: {s.explanationResponse}</p>}
                <button
                  className="mt-1 text-xs text-blue-700 hover:underline"
                  onClick={() => {
                    const explanationResponse = window.prompt("Record this party's explanation or response");
                    if (!explanationResponse) return;
                    run(() => postJson(`/api/investigations/${id}/subjects/${s.id}/response`, { explanationResponse }), "Subject response recorded.");
                  }}
                >
                  Record response
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Related operational records">
          <ul className="space-y-1 text-sm">
            {relatedRecords.length === 0 && <p className="text-slate-400">None linked.</p>}
            {relatedRecords.map((r) => (
              <li key={r.id} className="rounded border border-slate-100 p-2">
                [{r.recordType}] {r.recordId} {r.isReferralSource && <span className="rounded bg-slate-100 px-1 text-slate-600">referral source</span>}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Evidence">
          <div className="mb-3 flex gap-2">
            <input
              aria-label="Existing media asset id"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Existing media asset id"
              value={evidenceForm.mediaAssetId}
              onChange={(e) => setEvidenceForm((f) => ({ ...f, mediaAssetId: e.target.value }))}
            />
            <input
              aria-label="Linked evidence description"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Description"
              value={evidenceForm.description}
              onChange={(e) => setEvidenceForm((f) => ({ ...f, description: e.target.value }))}
            />
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              disabled={!evidenceForm.mediaAssetId || !evidenceForm.description}
              onClick={() =>
                run(async () => {
                  await postJson(`/api/investigations/${id}/evidence`, evidenceForm);
                  setEvidenceForm({ mediaAssetId: "", description: "" });
                }, "Evidence linked.")
              }
            >
              Link evidence
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2 rounded border border-slate-100 p-2">
            <input
              aria-label="Evidence file"
              type="file"
              className="text-xs"
              accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm"
              onChange={(e) => setEvidenceUpload((form) => ({ ...form, file: e.target.files?.[0] ?? null }))}
            />
            <input
              aria-label="Uploaded evidence description"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Uploaded evidence description"
              value={evidenceUpload.description}
              onChange={(e) => setEvidenceUpload((form) => ({ ...form, description: e.target.value }))}
            />
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              disabled={!evidenceUpload.file || !evidenceUpload.description}
              onClick={() =>
                run(async () => {
                  const form = new FormData();
                  form.set("file", evidenceUpload.file!);
                  form.set("description", evidenceUpload.description);
                  form.set("idempotencyKey", crypto.randomUUID());
                  const response = await fetch(`/api/investigations/${id}/evidence/upload`, { method: "POST", body: form });
                  const body = await response.json().catch(() => ({}));
                  if (!response.ok) throw new Error(body.error ?? "Evidence upload failed");
                  setEvidenceUpload({ file: null, description: "" });
                }, "Evidence uploaded and held.")
              }
            >
              Upload evidence
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {evidence.length === 0 && <p className="text-slate-400">No evidence linked.</p>}
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded border border-slate-100 p-2">
                <span>
                  #{e.evidenceNumber} {e.mediaAsset.fileName} — {e.description}
                  {e.enteredInError && <span className="ml-1 rounded bg-red-100 px-1 text-red-800">entered in error</span>}
                </span>
                <div className="flex gap-2">
                  <button
                    className="text-xs text-blue-700 hover:underline"
                    onClick={async () => {
                      const result = await getJson(`/api/investigations/${id}/evidence/${e.id}/download`);
                      if (result?.url) window.open(result.url, "_blank");
                    }}
                  >
                    Download
                  </button>
                  {!e.enteredInError && <button
                    className="text-xs text-red-700 hover:underline"
                    onClick={() => {
                      const reason = window.prompt("Reason for marking entered in error");
                      if (!reason) return;
                      run(() => postJson(`/api/investigations/${id}/evidence/${e.id}/entered-in-error`, { reason }), "Marked entered in error.");
                    }}
                  >
                    Mark entered in error
                  </button>}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Notes">
          <div className="mb-3 flex gap-2">
            <input
              aria-label="Investigation note"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Add a note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <select
              aria-label="Note confidentiality"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              value={noteConfidentiality}
              onChange={(e) => setNoteConfidentiality(e.target.value)}
            >
              <option value="STANDARD">Standard</option>
              <option value="RESTRICTED">Restricted</option>
              <option value="HIGHLY_RESTRICTED">Highly restricted</option>
            </select>
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              disabled={!noteText}
              onClick={() =>
                run(async () => {
                  await postJson(`/api/investigations/${id}/notes`, { content: noteText, confidentiality: noteConfidentiality });
                  setNoteText("");
                  setNoteConfidentiality("STANDARD");
                }, "Note added.")
              }
            >
              Add note
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {notes.length === 0 && <p className="text-slate-400">No notes yet.</p>}
            {notes.map((n) => (
              <li key={n.id} className="rounded border border-slate-100 p-2">
                <span className="text-xs text-slate-500">
                  {n.author.name} — {new Date(n.createdAt).toLocaleString()} {n.confidentiality !== "STANDARD" && `(${n.confidentiality})`}
                </span>
                <p>{n.content}</p>
                <button
                  className="text-xs text-blue-700 hover:underline"
                  onClick={() => {
                    const content = window.prompt("Amended/correction text");
                    if (!content) return;
                    run(() => postJson(`/api/investigations/${id}/notes/${n.id}/amend`, { content }), "Amendment recorded.");
                  }}
                >
                  Amend
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Tasks">
          <div className="mb-3 flex gap-2">
            <input
              aria-label="Task description"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Task description"
              value={taskForm.description}
              onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
            />
            <input
              aria-label="Task assignee user id"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Assignee user id"
              value={taskForm.assignedToUserId}
              onChange={(e) => setTaskForm((f) => ({ ...f, assignedToUserId: e.target.value }))}
            />
            <input
              aria-label="Task due date"
              type="datetime-local"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              value={taskForm.dueDate}
              onChange={(e) => setTaskForm((form) => ({ ...form, dueDate: e.target.value }))}
            />
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              disabled={!taskForm.description || !taskForm.assignedToUserId}
              onClick={() =>
                run(async () => {
                  await postJson(`/api/investigations/${id}/tasks`, { ...taskForm, dueDate: taskForm.dueDate || undefined });
                  setTaskForm({ description: "", assignedToUserId: "", dueDate: "" });
                }, "Task created.")
              }
            >
              Add task
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {tasks.length === 0 && <p className="text-slate-400">No tasks yet.</p>}
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded border border-slate-100 p-2">
                <span>
                  {t.description} — {t.assignedTo.name} ({t.status})
                  {t.dueDate && (
                    <span className={t.status !== "DONE" && new Date(t.dueDate) < new Date() ? "ml-1 text-red-700" : "ml-1 text-slate-500"}>
                      due {new Date(t.dueDate).toLocaleString()}
                    </span>
                  )}
                </span>
                {t.status !== "DONE" && t.status !== "CANCELLED" && (
                  <button
                    className="text-xs text-blue-700 hover:underline"
                    onClick={() => run(() => postJson(`/api/investigations/${id}/tasks/${t.id}`, { status: "DONE" }, "PATCH"), "Task completed.")}
                  >
                    Mark done
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Findings and approval">
          <div className="mb-3 space-y-2">
            <input
              aria-label="Finding executive summary"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Executive summary"
              value={findingForm.executiveSummary}
              onChange={(e) => setFindingForm((f) => ({ ...f, executiveSummary: e.target.value }))}
            />
            <textarea
              aria-label="Finding details"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Detailed findings"
              value={findingForm.detailedFindings}
              onChange={(e) => setFindingForm((f) => ({ ...f, detailedFindings: e.target.value }))}
            />
            <select
              aria-label="Finding outcome"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              value={findingForm.outcome}
              onChange={(e) => setFindingForm((f) => ({ ...f, outcome: e.target.value }))}
            >
              {["NOT_DETERMINED", "SUBSTANTIATED", "UNSUBSTANTIATED", "INCONCLUSIVE", "REFERRED_FOR_FURTHER_ACTION"].map((o) => (
                <option key={o} value={o}>
                  {o.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              disabled={!findingForm.executiveSummary || !findingForm.detailedFindings}
              onClick={() =>
                run(async () => {
                  await postJson(`/api/investigations/${id}/findings`, findingForm);
                  setFindingForm({ executiveSummary: "", detailedFindings: "", outcome: "NOT_DETERMINED" });
                }, "Finding drafted.")
              }
            >
              Draft finding
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {findings.length === 0 && <p className="text-slate-400">No findings yet.</p>}
            {findings.map((f) => (
              <li key={f.id} className="rounded border border-slate-100 p-2">
                <p>
                  v{f.version} — <span className="font-semibold">{f.status}</span> — {f.outcome}
                </p>
                <p className="text-xs text-slate-600">{f.executiveSummary}</p>
                <div className="mt-1 flex gap-2 text-xs">
                  {f.status === "DRAFT" && (
                    <button className="text-blue-700 hover:underline" onClick={() => run(() => postJson(`/api/investigations/${id}/findings/${f.id}/submit`), "Submitted for approval.")}>
                      Submit for approval
                    </button>
                  )}
                  {f.status === "SUBMITTED" && (
                    <>
                      <button className="text-emerald-700 hover:underline" onClick={() => run(() => postJson(`/api/investigations/${id}/findings/${f.id}/approve`, {}), "Finding approved.")}>
                        Approve
                      </button>
                      <button
                        className="text-amber-700 hover:underline"
                        onClick={() => {
                          const reason = window.prompt("Reason for returning for amendment");
                          if (!reason) return;
                          run(() => postJson(`/api/investigations/${id}/findings/${f.id}/return`, { reason }), "Returned for amendment.");
                        }}
                      >
                        Return for amendment
                      </button>
                      <button
                        className="text-red-700 hover:underline"
                        onClick={() => {
                          const reason = window.prompt("Reason for rejecting");
                          if (!reason) return;
                          run(() => postJson(`/api/investigations/${id}/findings/${f.id}/reject`, { reason }), "Finding rejected.");
                        }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {f.status === "APPROVED" && (
                    <button
                      className="text-blue-700 hover:underline"
                      onClick={() => run(() => postJson(`/api/investigations/${id}/reports`, { findingId: f.id }), "Report generated.")}
                    >
                      Generate report
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Reports">
          <ul className="space-y-1 text-sm">
            {reports.length === 0 && <p className="text-slate-400">No reports generated yet.</p>}
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded border border-slate-100 p-2">
                <span>
                  {r.fileName} — {new Date(r.createdAt).toLocaleString()}
                </span>
                <button
                  className="text-xs text-blue-700 hover:underline"
                  onClick={async () => {
                    try {
                      const result = await getJson(`/api/investigations/${id}/reports/${r.id}/download`);
                      if (result?.url) window.open(result.url, "_blank");
                    } catch {
                      setError("Failed to get download link.");
                    }
                  }}
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Chronology">
          <ul className="space-y-1 text-xs text-slate-600">
            {chronology.map((ev) => (
              <li key={ev.id}>
                {new Date(ev.occurredAt).toLocaleString()} — {ev.description} {ev.actor && `(${ev.actor.name})`}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50" onClick={onClick}>
      {children}
    </button>
  );
}
