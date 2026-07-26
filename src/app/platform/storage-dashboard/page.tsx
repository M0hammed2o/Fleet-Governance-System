"use client";

import { Fragment, useEffect, useState, useCallback } from "react";

interface StorageDashboardRow {
  tenant: { id: string; name: string; slug: string };
  activeVehicleCount: number;
  currentStorageBytes: number;
  storageByCategory: Array<{ category: string; totalBytes: number }>;
  monthlyStorageGrowthBytes: number;
  evidenceApproachingExpiryCount: number;
  evidenceUnderHoldCount: number;
  openExportRequestCount: number;
  pendingDeletionRequestCount: number;
  archivedBytes: number;
  archiveTierLabel: string;
  estimatedMonthlyArchiveChargeZarExclVat: number | null;
  failedUploadCount: number;
  storageWarnings: string[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${bytes < 0 ? "-" : ""}${value.toFixed(1)} ${units[exponent]}`;
}

function formatZar(amount: number | null): string {
  if (amount === null) return "Custom quote";
  return `R${amount.toLocaleString("en-ZA")}/mo`;
}

export default function PlatformStorageDashboardPage() {
  const [rows, setRows] = useState<StorageDashboardRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/storage-dashboard");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load dashboard");
      setRows(body.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Platform storage dashboard</h1>
        <p className="text-sm text-slate-500">
          Aggregate storage/retention posture per customer tenant — no individual evidence content is shown here (Phase 8D).
        </p>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-slate-500">Loading…</p>}

        {rows && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="p-3">Customer</th>
                  <th className="p-3">Active vehicles</th>
                  <th className="p-3">Current storage</th>
                  <th className="p-3">30-day growth</th>
                  <th className="p-3">Approaching expiry</th>
                  <th className="p-3">Under hold</th>
                  <th className="p-3">Export requests</th>
                  <th className="p-3">Pending deletions</th>
                  <th className="p-3">Archive plan</th>
                  <th className="p-3">Est. charge</th>
                  <th className="p-3">Failed uploads</th>
                  <th className="p-3">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.tenant.id}>
                    <tr
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                      onClick={() => setExpanded(expanded === row.tenant.id ? null : row.tenant.id)}
                    >
                      <td className="p-3 font-medium">{row.tenant.name}</td>
                      <td className="p-3">{row.activeVehicleCount}</td>
                      <td className="p-3">{formatBytes(row.currentStorageBytes)}</td>
                      <td className={`p-3 ${row.monthlyStorageGrowthBytes > 0 ? "text-amber-700" : "text-slate-500"}`}>
                        {row.monthlyStorageGrowthBytes >= 0 ? "+" : ""}
                        {formatBytes(row.monthlyStorageGrowthBytes)}
                      </td>
                      <td className={`p-3 ${row.evidenceApproachingExpiryCount > 0 ? "text-amber-700" : ""}`}>{row.evidenceApproachingExpiryCount}</td>
                      <td className="p-3">{row.evidenceUnderHoldCount}</td>
                      <td className="p-3">{row.openExportRequestCount}</td>
                      <td className="p-3">{row.pendingDeletionRequestCount}</td>
                      <td className="p-3 text-xs">{row.archiveTierLabel}</td>
                      <td className="p-3 text-xs">{formatZar(row.estimatedMonthlyArchiveChargeZarExclVat)}</td>
                      <td className={`p-3 ${row.failedUploadCount > 0 ? "text-red-700" : ""}`}>{row.failedUploadCount}</td>
                      <td className="p-3 text-xs text-amber-700">{row.storageWarnings.length > 0 ? `${row.storageWarnings.length} warning(s)` : "—"}</td>
                    </tr>
                    {expanded === row.tenant.id && (
                      <tr key={`${row.tenant.id}-detail`} className="border-b border-slate-100 bg-slate-50">
                        <td colSpan={12} className="p-4">
                          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                            <div>
                              <h3 className="mb-1 text-xs font-semibold text-slate-700">Storage by category</h3>
                              <ul className="space-y-1 text-xs text-slate-600">
                                {row.storageByCategory.length === 0 && <li className="text-slate-400">No evidence stored.</li>}
                                {row.storageByCategory.map((c) => (
                                  <li key={c.category} className="flex justify-between gap-4">
                                    <span>{c.category.replaceAll("_", " ")}</span>
                                    <span>{formatBytes(c.totalBytes)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h3 className="mb-1 text-xs font-semibold text-slate-700">Archive</h3>
                              <p className="text-xs text-slate-600">{formatBytes(row.archivedBytes)} archived · {row.archiveTierLabel}</p>
                            </div>
                            <div className="col-span-2">
                              <h3 className="mb-1 text-xs font-semibold text-slate-700">Warnings</h3>
                              {row.storageWarnings.length === 0 && <p className="text-xs text-slate-400">None.</p>}
                              <ul className="space-y-1 text-xs text-amber-700">
                                {row.storageWarnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="p-4 text-center text-slate-400">No customer tenants.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
