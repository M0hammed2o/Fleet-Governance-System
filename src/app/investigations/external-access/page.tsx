"use client";

import { useEffect, useState, useCallback } from "react";

interface Grant {
  id: string;
  reason: string;
  expiresAt: string;
  revokedAt: string | null;
  canDownloadReport: boolean;
  canDownloadEvidence: boolean;
  externalAuditor: { name: string; email: string };
  grantedBy: { name: string };
  cases: { case: { id: string; caseNumber: string; title: string } }[];
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

export default function ExternalAccessManagementPage() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ externalAuditorUserId: "", caseIds: "", reason: "", expiresAt: "", canDownloadReport: false, canDownloadEvidence: false });

  const load = useCallback(async () => {
    const res = await fetch("/api/investigations/external-access");
    const data = await res.json().catch(() => ({}));
    if (res.ok) setGrants(data.grants ?? []);
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function submitGrant() {
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/investigations/external-access", {
        externalAuditorUserId: form.externalAuditorUserId,
        caseIds: form.caseIds.split(",").map((s) => s.trim()).filter(Boolean),
        reason: form.reason,
        expiresAt: form.expiresAt,
        canDownloadReport: form.canDownloadReport,
        canDownloadEvidence: form.canDownloadEvidence,
      });
      setNotice("Access granted. No real external email is sent by this build — share portal access directly.");
      setForm({ externalAuditorUserId: "", caseIds: "", reason: "", expiresAt: "", canDownloadReport: false, canDownloadEvidence: false });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to grant access");
    }
  }

  async function revoke(grantId: string) {
    const reason = window.prompt("Reason for revoking");
    if (!reason) return;
    setError(null);
    try {
      await postJson(`/api/investigations/external-access/${grantId}/revoke`, { reason });
      setNotice("Access revoked immediately.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">External-auditor access</h1>
        <p className="text-sm text-slate-500">
          Grants are restricted, case-scoped, time-limited and revocable — not the platform support-access mechanism. The auditor must already hold the
          &quot;External Auditor (Case-Scoped)&quot; role.
        </p>

        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">New grant</h2>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="External auditor user id"
            value={form.externalAuditorUserId}
            onChange={(e) => setForm((f) => ({ ...f, externalAuditorUserId: e.target.value }))}
          />
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="Case ids (comma-separated)"
            value={form.caseIds}
            onChange={(e) => setForm((f) => ({ ...f, caseIds: e.target.value }))}
          />
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="Reason"
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
          <input
            type="datetime-local"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={form.expiresAt}
            onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
          />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={form.canDownloadReport} onChange={(e) => setForm((f) => ({ ...f, canDownloadReport: e.target.checked }))} />
            Can download report
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={form.canDownloadEvidence} onChange={(e) => setForm((f) => ({ ...f, canDownloadEvidence: e.target.checked }))} />
            Can download evidence
          </label>
          <button
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={!form.externalAuditorUserId || !form.caseIds || !form.reason || !form.expiresAt}
            onClick={submitGrant}
          >
            Grant access
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Existing grants</h2>
          <ul className="space-y-2 text-sm">
            {grants.length === 0 && <p className="text-slate-400">No grants yet.</p>}
            {grants.map((g) => (
              <li key={g.id} className="rounded border border-slate-100 p-2">
                <p>
                  {g.externalAuditor.name} ({g.externalAuditor.email}) — cases: {g.cases.map((c) => c.case.caseNumber).join(", ")}
                </p>
                <p className="text-xs text-slate-500">
                  Expires {new Date(g.expiresAt).toLocaleString()} {g.revokedAt && <span className="text-red-700">— revoked</span>}
                </p>
                {!g.revokedAt && (
                  <button className="text-xs text-red-700 hover:underline" onClick={() => revoke(g.id)}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
