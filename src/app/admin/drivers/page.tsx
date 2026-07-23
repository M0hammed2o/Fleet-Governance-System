"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface DriverRow {
  id: string;
  name: string;
  employeeNumber: string | null;
  status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED";
  licenceExpiry: string | null;
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/drivers", window.location.origin);
      if (search) url.searchParams.set("search", search);
      url.searchParams.set("page", String(page));
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load drivers");
      setDrivers(data.items);
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
      const res = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, employeeNumber: employeeNumber || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create driver");
        return;
      }
      setName("");
      setEmployeeNumber("");
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
        <h1 className="text-lg font-semibold text-slate-900">Drivers</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Add a driver</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
              placeholder="Employee number (optional)"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creating ? "Adding…" : "Add driver"}
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
            placeholder="Search by name, employee number, or licence number…"
            className="mb-4 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />

          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Employee #</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Licence expiry</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <Link href={`/admin/drivers/${d.id}`} className="text-slate-900 underline">
                        {d.name}
                      </Link>
                    </td>
                    <td className="py-2">{d.employeeNumber ?? "—"}</td>
                    <td className="py-2">
                      <span
                        className={
                          d.status === "ACTIVE"
                            ? "text-emerald-700"
                            : d.status === "SUSPENDED"
                              ? "text-amber-700"
                              : "text-red-700"
                        }
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="py-2">{d.licenceExpiry ? new Date(d.licenceExpiry).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
                {drivers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-400">
                      No drivers found
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
