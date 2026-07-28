"use client";

import { useEffect, useState, useCallback, use } from "react";

interface CaseDetail {
  caseNumber: string;
  title: string;
  description: string;
  status: string;
  outcome: string;
  createdAt: string;
  closedAt: string | null;
  assignedInvestigator: { name: string } | null;
}
interface EvidenceItem {
  id: string;
  evidenceNumber: number;
  description: string;
  addedAt: string;
  enteredInError: boolean;
}
interface ReportItem {
  id: string;
  fileName: string;
  createdAt: string;
}

export default function ExternalAuditorCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [caseRes, evidenceRes, reportsRes] = await Promise.all([
        fetch(`/api/external-auditor/cases/${id}`),
        fetch(`/api/external-auditor/cases/${id}/evidence`),
        fetch(`/api/external-auditor/cases/${id}/reports`),
      ]);
      const caseData = await caseRes.json();
      if (!caseRes.ok) throw new Error(caseData.error ?? "Access denied.");
      setCaseDetail(caseData.investigationCase);
      const evidenceData = await evidenceRes.json().catch(() => ({}));
      if (evidenceRes.ok) setEvidence(evidenceData.evidence ?? []);
      const reportsData = await reportsRes.json().catch(() => ({}));
      if (reportsRes.ok) setReports(reportsData.reports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function download(kind: "evidence" | "reports", itemId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/external-auditor/cases/${id}/${kind}/${itemId}/download`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Download not permitted.");
      window.open(data.url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    }
  }

  if (loading) return <main className="min-h-screen bg-slate-50 p-8 text-sm text-slate-400">Loading…</main>;
  if (!caseDetail) return <main className="min-h-screen bg-slate-50 p-8 text-sm text-red-700">{error ?? "Not accessible."}</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{caseDetail.title}</h1>
          <p className="text-sm text-slate-600">{caseDetail.description}</p>
          <p className="mt-2 text-xs text-slate-500">
            Status: {caseDetail.status.replaceAll("_", " ")} — Outcome: {caseDetail.outcome.replaceAll("_", " ")}
          </p>
          {caseDetail.assignedInvestigator && <p className="text-xs text-slate-500">Investigator: {caseDetail.assignedInvestigator.name}</p>}
        </div>

        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Evidence manifest</h2>
          <ul className="space-y-1 text-sm">
            {evidence.length === 0 && <p className="text-slate-400">No evidence recorded.</p>}
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded border border-slate-100 p-2">
                <span>
                  #{e.evidenceNumber} {e.description}
                  {e.enteredInError && <span className="ml-1 rounded bg-red-100 px-1 text-red-800">entered in error</span>}
                </span>
                <button className="text-xs text-blue-700 hover:underline" onClick={() => download("evidence", e.id)}>
                  Download
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Reports</h2>
          <ul className="space-y-1 text-sm">
            {reports.length === 0 && <p className="text-slate-400">No reports generated yet.</p>}
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded border border-slate-100 p-2">
                <span>{r.fileName}</span>
                <button className="text-xs text-blue-700 hover:underline" onClick={() => download("reports", r.id)}>
                  Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
