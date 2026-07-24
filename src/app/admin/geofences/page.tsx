"use client";

import { useEffect, useState, useCallback } from "react";

interface GeofenceRow {
  id: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
}

export default function GeofencesPage() {
  const [geofences, setGeofences] = useState<GeofenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", centerLatitude: "", centerLongitude: "", radiusMeters: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/geofences");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load geofences");
      setGeofences(data.geofences);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/admin/geofences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create geofence");
        return;
      }
      setForm({ name: "", centerLatitude: "", centerLongitude: "", radiusMeters: "" });
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Geofences</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">New geofence</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" />
            <input value={form.centerLatitude} onChange={(e) => setForm((f) => ({ ...f, centerLatitude: e.target.value }))} placeholder="Center latitude" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={form.centerLongitude} onChange={(e) => setForm((f) => ({ ...f, centerLongitude: e.target.value }))} placeholder="Center longitude" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={form.radiusMeters} onChange={(e) => setForm((f) => ({ ...f, radiusMeters: e.target.value }))} placeholder="Radius (metres)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" />
            <button type="submit" disabled={creating || !form.name || !form.centerLatitude || !form.centerLongitude || !form.radiusMeters} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-2">
              {creating ? "Creating…" : "Create geofence"}
            </button>
          </form>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Center</th>
                  <th className="pb-2">Radius (m)</th>
                </tr>
              </thead>
              <tbody>
                {geofences.map((g) => (
                  <tr key={g.id} className="border-b border-slate-100">
                    <td className="py-2">{g.name}</td>
                    <td className="py-2 font-mono text-xs">{g.centerLatitude}, {g.centerLongitude}</td>
                    <td className="py-2">{g.radiusMeters}</td>
                  </tr>
                ))}
                {geofences.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-slate-400">No geofences configured</td>
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
