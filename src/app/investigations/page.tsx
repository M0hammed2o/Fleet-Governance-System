"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface DashboardCounts {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  overdueTaskCount: number;
  awaitingApprovalCount: number;
  activeHoldCount: number;
  recentlyUpdated: CaseSummary[];
}

interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  outcome: string;
  confidentiality: string;
  source: string;
  updatedAt: string;
}

const SOURCE_OPTIONS = [
  { value: "MANUAL_CONCERN", label: "Manual concern" },
  { value: "SUSPECTED_UNAUTHORISED_USE", label: "Suspected unauthorised use" },
  { value: "MISSING_EVIDENCE", label: "Missing evidence" },
  { value: "GATE_EXCEPTION", label: "Gate exception (other)" },
  { value: "OTHER", label: "Other" },
] as const;

const REFERRAL_SOURCE_OPTIONS = [
  { value: "EXCEPTION", label: "Gate / GPS exception" },
  { value: "FACIAL_VERIFICATION_ATTEMPT", label: "Facial verification attempt" },
  { value: "GATE_EVENT_INSPECTION_ITEM", label: "Vehicle inspection item" },
  { value: "RECONCILIATION_DISCREPANCY", label: "Reconciliation discrepancy" },
] as const;

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

export default function InvestigationsDashboardPage() {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showRefer, setShowRefer] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", source: "MANUAL_CONCERN", caseOwnerUserId: "" });
  const [referForm, setReferForm] = useState({ sourceType: "EXCEPTION", sourceRecordId: "", title: "", caseOwnerUserId: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const [countsRes, casesRes] = await Promise.all([fetch("/api/investigations/dashboard"), fetch(`/api/investigations?${params.toString()}`)]);
      const countsData = await countsRes.json();
      const casesData = await casesRes.json();
      if (!countsRes.ok) throw new Error(countsData.error ?? "Failed to load dashboard");
      if (!casesRes.ok) throw new Error(casesData.error ?? "Failed to load cases");
      setCounts(countsData);
      setCases(casesData.cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function submitCreate() {
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/investigations", {
        title: createForm.title,
        description: createForm.description,
        source: createForm.source,
        caseOwnerUserId: createForm.caseOwnerUserId || undefined,
      });
      setNotice("Case created.");
      setShowCreate(false);
      setCreateForm({ title: "", description: "", source: "MANUAL_CONCERN", caseOwnerUserId: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create case");
    }
  }

  async function submitReferral() {
    setError(null);
    setNotice(null);
    try {
      const result = await postJson("/api/investigations/referrals", referForm);
      setNotice(result.wasExistingCase ? "An open case already existed for this record — reused it." : "Case created from referral.");
      setShowRefer(false);
      setReferForm({ sourceType: "EXCEPTION", sourceRecordId: "", title: "", caseOwnerUserId: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create referral");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Investigations</h1>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => setShowRefer((v) => !v)}>
              Refer a record
            </button>
            <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700" onClick={() => setShowCreate((v) => !v)}>
              New case
            </button>
          </div>
        </div>

        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

        {showCreate && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Create a case manually</h2>
            <input
              aria-label="Case title"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Title"
              value={createForm.title}
              onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
            />
            <textarea
              aria-label="Case description"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Description / allegation as reported"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
            />
            <select
              aria-label="Case source"
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={createForm.source}
              onChange={(e) => setCreateForm((f) => ({ ...f, source: e.target.value }))}
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Case owner user id"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Case owner user id (optional — defaults to you)"
              value={createForm.caseOwnerUserId}
              onChange={(e) => setCreateForm((f) => ({ ...f, caseOwnerUserId: e.target.value }))}
            />
            <button
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              disabled={!createForm.title || !createForm.description}
              onClick={submitCreate}
            >
              Create
            </button>
          </div>
        )}

        {showRefer && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Refer an operational record to investigation</h2>
            <p className="text-xs text-slate-500">Opening a case never alters the original record — it stays under its own operational workflow.</p>
            <select
              aria-label="Referral source type"
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={referForm.sourceType}
              onChange={(e) => setReferForm((f) => ({ ...f, sourceType: e.target.value }))}
            >
              {REFERRAL_SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Referral source record id"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Source record id"
              value={referForm.sourceRecordId}
              onChange={(e) => setReferForm((f) => ({ ...f, sourceRecordId: e.target.value }))}
            />
            <input
              aria-label="Referral case title"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Case title"
              value={referForm.title}
              onChange={(e) => setReferForm((f) => ({ ...f, title: e.target.value }))}
            />
            <input
              aria-label="Referral case owner user id"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Case owner user id"
              value={referForm.caseOwnerUserId}
              onChange={(e) => setReferForm((f) => ({ ...f, caseOwnerUserId: e.target.value }))}
            />
            <button
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              disabled={!referForm.sourceRecordId || !referForm.title || !referForm.caseOwnerUserId}
              onClick={submitReferral}
            >
              Refer
            </button>
          </div>
        )}

        {counts && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Open cases" value={Object.entries(counts.byStatus).filter(([s]) => s !== "CLOSED").reduce((sum, [, n]) => sum + n, 0)} />
            <StatCard label="Awaiting approval" value={counts.awaitingApprovalCount} />
            <StatCard label="Overdue tasks" value={counts.overdueTaskCount} tone={counts.overdueTaskCount > 0 ? "warn" : "default"} />
            <StatCard label="Active evidence holds" value={counts.activeHoldCount} />
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <select aria-label="Investigation status filter" className="max-w-full rounded border border-slate-300 px-2 py-1 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {["DRAFT", "OPEN", "TRIAGE", "UNDER_INVESTIGATION", "AWAITING_INFORMATION", "AWAITING_APPROVAL", "CLOSED", "REOPENED"].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <input
            className="min-w-0 rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="Search title or case number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {!loading && cases.length === 0 && <p className="text-sm text-slate-400">No cases match this filter.</p>}
          {!loading && cases.length > 0 && (
            <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2">Case</th>
                  <th className="pb-2">Title</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Priority</th>
                  <th className="pb-2">Confidentiality</th>
                  <th className="pb-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <Link href={`/investigations/${c.id}`} className="font-mono text-blue-700 hover:underline">
                        {c.caseNumber}
                      </Link>
                    </td>
                    <td className="py-2">{c.title}</td>
                    <td className="py-2">{c.status.replaceAll("_", " ")}</td>
                    <td className="py-2">{c.priority}</td>
                    <td className="py-2">{c.confidentiality !== "STANDARD" && <span className="rounded bg-amber-100 px-1 text-amber-800">{c.confidentiality}</span>}</td>
                    <td className="py-2">{new Date(c.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" }) {
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${tone === "warn" && value > 0 ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
