"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface VehicleRow {
  id: string;
  registrationNumber: string;
  fleetNumber: string | null;
  make: string | null;
  model: string | null;
  operationalStatus: "OPERATIONAL" | "WORKSHOP_LOCKOUT" | "SECURITY_LOCKOUT" | "DECOMMISSIONED";
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registrationNumber, setRegistrationNumber] = useState("");
  const [fleetNumber, setFleetNumber] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/vehicles", window.location.origin);
      if (search) url.searchParams.set("search", search);
      url.searchParams.set("page", String(page));
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load vehicles");
      setVehicles(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationNumber, fleetNumber: fleetNumber || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create vehicle");
        return;
      }
      setRegistrationNumber("");
      setFleetNumber("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Vehicles</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Add a vehicle</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <input
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              placeholder="Registration number"
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              value={fleetNumber}
              onChange={(e) => setFleetNumber(e.target.value)}
              placeholder="Fleet number (optional)"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creating ? "Adding…" : "Add vehicle"}
            </button>
          </form>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search by registration, fleet number, or VIN…"
            className="mb-4 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />

          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Registration</th>
                  <th className="pb-2">Fleet #</th>
                  <th className="pb-2">Make/Model</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <Link href={`/admin/vehicles/${v.id}`} className="text-slate-900 underline">
                        {v.registrationNumber}
                      </Link>
                    </td>
                    <td className="py-2">{v.fleetNumber ?? "—"}</td>
                    <td className="py-2">{[v.make, v.model].filter(Boolean).join(" ") || "—"}</td>
                    <td className="py-2">
                      <span className={v.operationalStatus === "OPERATIONAL" ? "text-emerald-700" : "text-red-700"}>
                        {v.operationalStatus}
                      </span>
                    </td>
                  </tr>
                ))}
                {vehicles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-400">
                      No vehicles found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-slate-500">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
