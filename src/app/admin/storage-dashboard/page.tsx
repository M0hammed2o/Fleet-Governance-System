"use client";

import { useEffect, useState, useCallback } from "react";

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
  return `R${amount.toLocaleString("en-ZA")}/mo excl. VAT`;
}

function StatTile({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "warn" | "danger" }) {
  const toneClasses: Record<string, string> = { default: "text-slate-900", warn: "text-amber-700", danger: "text-red-700" };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${toneClasses[tone]}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default function CustomerStorageDashboardPage() {
  const [row, setRow] = useState<StorageDashboardRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/retention/storage-dashboard");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load dashboard");
      setRow(body.row);
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
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Storage &amp; retention</h1>
        <p className="text-sm text-slate-500">Your organisation&apos;s evidence storage usage and retention status (Phase 8D).</p>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-slate-500">Loading…</p>}

        {row && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatTile label="Current storage" value={formatBytes(row.currentStorageBytes)} />
              <StatTile
                label="30-day growth"
                value={`${row.monthlyStorageGrowthBytes >= 0 ? "+" : ""}${formatBytes(row.monthlyStorageGrowthBytes)}`}
                tone={row.monthlyStorageGrowthBytes > 0 ? "warn" : "default"}
              />
              <StatTile label="Active vehicles" value={row.activeVehicleCount} />
              <StatTile label="Archived storage" value={formatBytes(row.archivedBytes)} />
              <StatTile label="Approaching expiry" value={row.evidenceApproachingExpiryCount} tone={row.evidenceApproachingExpiryCount > 0 ? "warn" : "default"} />
              <StatTile label="Under legal/investigation hold" value={row.evidenceUnderHoldCount} />
              <StatTile label="Open export requests" value={row.openExportRequestCount} />
              <StatTile label="Pending deletion requests" value={row.pendingDeletionRequestCount} />
              <StatTile label="Failed uploads" value={row.failedUploadCount} tone={row.failedUploadCount > 0 ? "danger" : "default"} />
              <StatTile label="Archive plan" value={row.archiveTierLabel} />
              <StatTile label="Estimated archive charge" value={formatZar(row.estimatedMonthlyArchiveChargeZarExclVat)} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Storage by category</h2>
              {row.storageByCategory.length === 0 && <p className="text-sm text-slate-400">No evidence stored yet.</p>}
              <ul className="space-y-2 text-sm">
                {row.storageByCategory.map((c) => (
                  <li key={c.category} className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span>{c.category.replaceAll("_", " ")}</span>
                    <span className="text-slate-500">{formatBytes(c.totalBytes)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Retention actions available</h2>
              <p className="mb-3 text-xs text-slate-500">
                Available to Company Administrators (initiate deletion/export) and Security Supervisors / Approving Managers (approve deletion) — see your role&apos;s permissions.
              </p>
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                <li>Apply or release a legal/investigation hold on specific evidence.</li>
                <li>Extend the retention period for specific evidence.</li>
                <li>Move eligible evidence to paid archive storage.</li>
                <li>Initiate a scoped deletion request (requires a second authorised user&apos;s approval, then a 30-day recovery window).</li>
                <li>Request a signed export of evidence before deletion.</li>
              </ul>
            </section>

            {row.storageWarnings.length > 0 && (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-amber-900">Warnings</h2>
                <ul className="space-y-1 text-sm text-amber-800">
                  {row.storageWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
