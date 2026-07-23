"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface ReconciliationRow {
  id: string;
  status: string;
  kmTravelled: number | null;
  createdAt: string;
  movementAuthorisation: {
    referenceCode: string;
    vehicle: { registrationNumber: string };
    driver: { name: string };
  };
  discrepancies: { id: string; status: string; severity: string }[];
}

const STATUS_FILTERS = ["ALL", "OPEN", "RESOLVED", "NO_DISCREPANCIES"];

export default function ReconciliationsPage() {
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/reconciliations", window.location.origin);
      if (statusFilter !== "ALL") url.searchParams.set("status", statusFilter);
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load reconciliations");
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Departure/return reconciliation</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="text-sm text-slate-500">{total} total</span>
          </div>

          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Movement</th>
                  <th className="pb-2">Vehicle</th>
                  <th className="pb-2">Driver</th>
                  <th className="pb-2">Km travelled</th>
                  <th className="pb-2">Open discrepancies</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const openCount = r.discrepancies.filter((d) => d.status === "OPEN").length;
                  const highCount = r.discrepancies.filter((d) => d.status === "OPEN" && d.severity === "HIGH").length;
                  return (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-2">
                        <Link href={`/admin/reconciliations/${r.id}`} className="font-mono text-xs text-slate-900 underline">
                          {r.movementAuthorisation.referenceCode}
                        </Link>
                      </td>
                      <td className="py-2">{r.movementAuthorisation.vehicle.registrationNumber}</td>
                      <td className="py-2">{r.movementAuthorisation.driver.name}</td>
                      <td className="py-2">{r.kmTravelled ?? "—"}</td>
                      <td className="py-2">
                        {openCount > 0 ? (
                          <span className={highCount > 0 ? "font-medium text-red-700" : "text-amber-700"}>{openCount}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="py-2">{r.status}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-400">No reconciliations found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
