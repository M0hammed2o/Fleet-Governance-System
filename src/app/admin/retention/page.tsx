"use client";

import { useEffect, useState, useCallback } from "react";

const CATEGORIES = [
  "DRIVER_PORTRAIT",
  "FACIAL_AUDIT",
  "VEHICLE_INSPECTION_PHOTO",
  "VEHICLE_INSPECTION_VIDEO",
  "DAMAGE_EVIDENCE",
  "CARGO_EVIDENCE",
  "DELIVERY_DOCUMENT",
  "INVESTIGATION_EVIDENCE",
  "GENERATED_REPORT",
  "OTHER_DOCUMENT",
] as const;

interface RetentionPolicy {
  category: string;
  retentionDays: number;
  includedStorageAllowanceBytes: number | null;
  archiveEligible: boolean;
}

interface EvidenceItem {
  id: string;
  category: string;
  fileName: string;
  fileSizeBytes: number;
  capturedAt: string;
  retentionStatus: string;
  scheduledDeletionAt: string | null;
  legalHold: boolean;
  investigationHold: boolean;
  retentionExtendedAt: string | null;
}

interface DeletionRequest {
  id: string;
  status: string;
  categories: string[];
  assetCount: number | null;
  totalBytes: number | null;
  initiatedByUserId: string;
  approvedByUserId: string | null;
  recoveryExpiresAt: string | null;
  completedAt: string | null;
  certificate: { id: string; assetCount: number; totalBytes: number; issuedAt: string } | null;
}

interface ExportRequestItem {
  id: string;
  status: string;
  categories: string[];
  assetCount: number | null;
  totalBytes: number | null;
  expiresAt: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
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

export default function RetentionManagementPage() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [evidenceFilter, setEvidenceFilter] = useState<{ category: string; onlyHeld: boolean; onlyApproachingExpiry: boolean }>({
    category: "",
    onlyHeld: false,
    onlyApproachingExpiry: false,
  });
  const [selectedForArchive, setSelectedForArchive] = useState<Set<string>>(new Set());
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [exportRequests, setExportRequests] = useState<ExportRequestItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // New deletion/export request form state
  const [scopeCategories, setScopeCategories] = useState<string[]>([]);
  const [scopeStart, setScopeStart] = useState("");
  const [scopeEnd, setScopeEnd] = useState("");

  const loadPolicies = useCallback(async () => {
    const res = await fetch("/api/admin/retention-policies");
    const data = await res.json();
    if (res.ok) setPolicies(data.policies);
  }, []);

  const loadEvidence = useCallback(async () => {
    const params = new URLSearchParams();
    if (evidenceFilter.category) params.set("category", evidenceFilter.category);
    if (evidenceFilter.onlyHeld) params.set("onlyHeld", "true");
    if (evidenceFilter.onlyApproachingExpiry) params.set("onlyApproachingExpiry", "true");
    const res = await fetch(`/api/retention/evidence?${params.toString()}`);
    const data = await res.json();
    if (res.ok) setEvidence(data.evidence);
  }, [evidenceFilter]);

  const loadDeletionRequests = useCallback(async () => {
    const res = await fetch("/api/retention/deletion-requests");
    const data = await res.json();
    if (res.ok) setDeletionRequests(data.deletionRequests);
  }, []);

  const loadExportRequests = useCallback(async () => {
    const res = await fetch("/api/retention/export-requests");
    const data = await res.json();
    if (res.ok) setExportRequests(data.exportRequests);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadPolicies(), loadEvidence(), loadDeletionRequests(), loadExportRequests()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [loadPolicies, loadEvidence, loadDeletionRequests, loadExportRequests]);

  useEffect(() => {
    queueMicrotask(loadAll);
  }, [loadAll]);

  useEffect(() => {
    queueMicrotask(loadEvidence);
  }, [loadEvidence]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  function toggleArchiveSelection(id: string) {
    setSelectedForArchive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleScopeCategory(category: string) {
    setScopeCategories((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));
  }

  function scopeBody() {
    return {
      scope: {
        categories: scopeCategories,
        ...(scopeStart ? { dateRangeStart: scopeStart } : {}),
        ...(scopeEnd ? { dateRangeEnd: scopeEnd } : {}),
      },
    };
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Retention management</h1>
          <p className="text-sm text-slate-500">
            Retention policies, evidence approaching expiry, legal/investigation holds, extensions, archive, export and
            deletion requests (Phase 8E-005). Deletion requires a second, different authorised user&apos;s approval and a
            recovery window before anything is permanently removed.
          </p>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
        {loading && <p className="text-sm text-slate-500">Loading…</p>}

        {/* Retention policies */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Retention policies by category</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="pb-2">Category</th>
                <th className="pb-2">Retention (days)</th>
                <th className="pb-2">Archive eligible</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((category) => {
                const existing = policies.find((p) => p.category === category);
                return (
                  <tr key={category} className="border-b border-slate-100">
                    <td className="py-2">{category.replaceAll("_", " ")}</td>
                    <td className="py-2">{existing ? existing.retentionDays : 365} {!existing && <span className="text-xs text-slate-400">(default)</span>}</td>
                    <td className="py-2">{(existing?.archiveEligible ?? true) ? "Yes" : "No"}</td>
                    <td className="py-2">
                      <button
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                        onClick={() => {
                          const input = window.prompt(`New retention days for ${category}`, String(existing?.retentionDays ?? 365));
                          if (!input) return;
                          const retentionDays = parseInt(input, 10);
                          if (Number.isNaN(retentionDays) || retentionDays <= 0) return;
                          run(() => postJson("/api/admin/retention-policies", { category, retentionDays }), "Retention policy updated.");
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* Evidence browser */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Evidence</h2>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
            <select
              className="rounded-md border border-slate-300 px-2 py-1"
              value={evidenceFilter.category}
              onChange={(e) => setEvidenceFilter((prev) => ({ ...prev, category: e.target.value }))}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={evidenceFilter.onlyApproachingExpiry}
                onChange={(e) => setEvidenceFilter((prev) => ({ ...prev, onlyApproachingExpiry: e.target.checked }))}
              />
              Approaching expiry (90 days)
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={evidenceFilter.onlyHeld}
                onChange={(e) => setEvidenceFilter((prev) => ({ ...prev, onlyHeld: e.target.checked }))}
              />
              Under legal/investigation hold
            </label>
            <button
              disabled={selectedForArchive.size === 0}
              className="ml-auto rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              onClick={() =>
                run(
                  () => postJson("/api/retention/archive", { mediaAssetIds: Array.from(selectedForArchive) }),
                  `${selectedForArchive.size} asset(s) moved to archive.`,
                ).then(() => setSelectedForArchive(new Set()))
              }
            >
              Move {selectedForArchive.size || ""} selected to archive
            </button>
          </div>

          {evidence.length === 0 && <p className="text-sm text-slate-400">No evidence matches this filter.</p>}
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2"></th>
                <th className="pb-2">File</th>
                <th className="pb-2">Category</th>
                <th className="pb-2">Size</th>
                <th className="pb-2">Scheduled deletion</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="py-2">
                    <input type="checkbox" checked={selectedForArchive.has(item.id)} onChange={() => toggleArchiveSelection(item.id)} />
                  </td>
                  <td className="py-2">{item.fileName}</td>
                  <td className="py-2">{item.category.replaceAll("_", " ")}</td>
                  <td className="py-2">{formatBytes(item.fileSizeBytes)}</td>
                  <td className="py-2">{formatDate(item.scheduledDeletionAt)}</td>
                  <td className="py-2">
                    {item.retentionStatus}
                    {item.legalHold && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">legal hold</span>}
                    {item.investigationHold && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">investigation hold</span>}
                    {item.retentionExtendedAt && <span className="ml-1 rounded bg-blue-100 px-1 text-blue-800">extended</span>}
                  </td>
                  <td className="space-x-2 py-2">
                    <button
                      className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                      onClick={() => {
                        const reason = window.prompt(item.legalHold ? "Reason for releasing legal hold" : "Reason for applying legal hold");
                        if (!reason) return;
                        run(
                          () => postJson(`/api/media/${item.id}/legal-hold`, { hold: !item.legalHold, reason }, "PATCH"),
                          "Legal hold updated.",
                        );
                      }}
                    >
                      {item.legalHold ? "Release legal hold" : "Legal hold"}
                    </button>
                    <button
                      className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                      onClick={() => {
                        const reason = window.prompt(item.investigationHold ? "Reason for releasing investigation hold" : "Reason for applying investigation hold");
                        if (!reason) return;
                        run(
                          () => postJson(`/api/media/${item.id}/investigation-hold`, { hold: !item.investigationHold, reason }, "PATCH"),
                          "Investigation hold updated.",
                        );
                      }}
                    >
                      {item.investigationHold ? "Release investigation hold" : "Investigation hold"}
                    </button>
                    <button
                      className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                      onClick={() => {
                        const days = window.prompt("Extend retention by how many days from now?", "90");
                        if (!days) return;
                        const numDays = parseInt(days, 10);
                        if (Number.isNaN(numDays) || numDays <= 0) return;
                        const reason = window.prompt("Reason for extending retention");
                        if (!reason) return;
                        const newScheduledDeletionAt = new Date(Date.now() + numDays * 24 * 60 * 60 * 1000).toISOString();
                        run(
                          () => postJson(`/api/media/${item.id}/extend-retention`, { newScheduledDeletionAt, reason }, "PATCH"),
                          "Retention extended.",
                        );
                      }}
                    >
                      Extend
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Export & deletion scope form */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Export or request deletion by category / date range</h2>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1">
                <input type="checkbox" checked={scopeCategories.includes(c)} onChange={() => toggleScopeCategory(c)} />
                {c.replaceAll("_", " ")}
              </label>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-3 text-xs">
            <label>
              From <input type="date" value={scopeStart} onChange={(e) => setScopeStart(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
            </label>
            <label>
              To <input type="date" value={scopeEnd} onChange={(e) => setScopeEnd(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              disabled={scopeCategories.length === 0}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs disabled:opacity-40"
              onClick={() => run(() => postJson("/api/retention/export-requests", scopeBody()), "Export request created.")}
            >
              Request export
            </button>
            <button
              disabled={scopeCategories.length === 0}
              className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-40"
              onClick={() => run(() => postJson("/api/retention/deletion-requests", scopeBody()), "Deletion request created — awaiting a second user's approval.")}
            >
              Request deletion
            </button>
          </div>
        </section>

        {/* Export requests */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Export requests</h2>
          {exportRequests.length === 0 && <p className="text-sm text-slate-400">No export requests yet.</p>}
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2">Categories</th>
                <th className="pb-2">Assets</th>
                <th className="pb-2">Size</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Expires</th>
              </tr>
            </thead>
            <tbody>
              {exportRequests.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2">{r.categories.map((c) => c.replaceAll("_", " ")).join(", ")}</td>
                  <td className="py-2">{r.assetCount ?? "—"}</td>
                  <td className="py-2">{formatBytes(r.totalBytes ?? 0)}</td>
                  <td className="py-2">{r.status}</td>
                  <td className="py-2">{formatDate(r.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Deletion requests — approval, recovery status, certificates */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Deletion requests</h2>
          <p className="mb-3 text-xs text-slate-500">
            The user who initiated a request can never approve, reject, or count as the second approver for it — the
            server enforces this even if the button below is clicked.
          </p>
          {deletionRequests.length === 0 && <p className="text-sm text-slate-400">No deletion requests yet.</p>}
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2">Categories</th>
                <th className="pb-2">Assets</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Recovery expires</th>
                <th className="pb-2">Certificate</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deletionRequests.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2">{r.categories.map((c) => c.replaceAll("_", " ")).join(", ")}</td>
                  <td className="py-2">{r.assetCount ?? "—"} ({formatBytes(r.totalBytes ?? 0)})</td>
                  <td className="py-2">{r.status}</td>
                  <td className="py-2">{formatDate(r.recoveryExpiresAt)}</td>
                  <td className="py-2">
                    {r.certificate ? `${r.certificate.assetCount} deleted · ${formatDate(r.certificate.issuedAt)}` : "—"}
                  </td>
                  <td className="space-x-2 py-2">
                    {r.status === "PENDING_APPROVAL" && (
                      <>
                        <button
                          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                          onClick={() => run(() => postJson(`/api/retention/deletion-requests/${r.id}/approve`, undefined), "Deletion request approved — recovery window started.")}
                        >
                          Approve
                        </button>
                        <button
                          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                          onClick={() => {
                            const reason = window.prompt("Reason for rejecting this deletion request");
                            if (!reason) return;
                            run(() => postJson(`/api/retention/deletion-requests/${r.id}/reject`, { reason }), "Deletion request rejected.");
                          }}
                        >
                          Reject
                        </button>
                        <button
                          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                          onClick={() => run(() => postJson(`/api/retention/deletion-requests/${r.id}/cancel`, undefined), "Deletion request cancelled.")}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {r.status === "APPROVED" && (
                      <button
                        className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                        onClick={() => run(() => postJson(`/api/retention/deletion-requests/${r.id}/complete`, undefined), "Deletion completed — certificate issued.")}
                      >
                        Complete now (if recovery period has elapsed)
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
