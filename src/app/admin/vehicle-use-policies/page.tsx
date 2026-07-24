"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface PolicyRow {
  id: string;
  name: string;
  status: string;
  driver: { name: string };
  vehicles: { vehicle: { registrationNumber: string } }[];
  approvingManager: { name: string } | null;
}

interface Option {
  id: string;
  label: string;
}

export default function VehicleUsePoliciesPage() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [drivers, setDrivers] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<Option[]>([]);
  const [geofences, setGeofences] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    driverId: "",
    vehicleId: "",
    effectiveFrom: "",
    approvedGeofenceId: "",
    kmLimitPerTrip: "",
    allowAfterHours: false,
    allowWeekend: false,
  });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policiesRes, driversRes, vehiclesRes, geofencesRes] = await Promise.all([
        fetch("/api/vehicle-use-policies"),
        fetch("/api/drivers?pageSize=100"),
        fetch("/api/vehicles?pageSize=100"),
        fetch("/api/admin/geofences"),
      ]);
      const policiesData = await policiesRes.json();
      if (!policiesRes.ok) throw new Error(policiesData.error ?? "Failed to load policies");
      setPolicies(policiesData.policies);

      if (driversRes.ok) {
        const d = await driversRes.json();
        const opts = d.items.map((x: { id: string; name: string }) => ({ id: x.id, label: x.name }));
        setDrivers(opts);
        setForm((f) => ({ ...f, driverId: f.driverId || opts[0]?.id || "" }));
      }
      if (vehiclesRes.ok) {
        const v = await vehiclesRes.json();
        const opts = v.items.map((x: { id: string; registrationNumber: string }) => ({ id: x.id, label: x.registrationNumber }));
        setVehicles(opts);
        setForm((f) => ({ ...f, vehicleId: f.vehicleId || opts[0]?.id || "" }));
      }
      if (geofencesRes.ok) {
        const g = await geofencesRes.json();
        setGeofences(g.geofences.map((x: { id: string; name: string }) => ({ id: x.id, label: x.name })));
      }
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
      const res = await fetch("/api/vehicle-use-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          driverId: form.driverId,
          vehicleIds: [form.vehicleId],
          effectiveFrom: new Date(form.effectiveFrom || Date.now()).toISOString(),
          approvedGeofenceId: form.approvedGeofenceId || undefined,
          kmLimitPerTrip: form.kmLimitPerTrip ? Number(form.kmLimitPerTrip) : undefined,
          allowAfterHours: form.allowAfterHours,
          allowWeekend: form.allowWeekend,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create policy");
        return;
      }
      setForm((f) => ({ ...f, name: "", effectiveFrom: "", kmLimitPerTrip: "" }));
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function approve(id: string) {
    setError(null);
    const res = await fetch(`/api/vehicle-use-policies/${id}/approve`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to approve policy");
      return;
    }
    await load();
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Vehicle-use policies</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">New policy</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Policy name" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" />
            <select value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <select value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <input type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <select value={form.approvedGeofenceId} onChange={(e) => setForm((f) => ({ ...f, approvedGeofenceId: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">No approved geofence</option>
              {geofences.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <input value={form.kmLimitPerTrip} onChange={(e) => setForm((f) => ({ ...f, kmLimitPerTrip: e.target.value }))} placeholder="Km limit per trip" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.allowAfterHours} onChange={(e) => setForm((f) => ({ ...f, allowAfterHours: e.target.checked }))} />
              Allow after-hours use
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.allowWeekend} onChange={(e) => setForm((f) => ({ ...f, allowWeekend: e.target.checked }))} />
              Allow weekend use
            </label>
            <button type="submit" disabled={creating || !form.name || !form.driverId || !form.vehicleId} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-2">
              {creating ? "Creating…" : "Create draft policy"}
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
                  <th className="pb-2">Driver</th>
                  <th className="pb-2">Vehicles</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <Link href={`/admin/vehicle-use-policies/${p.id}`} className="underline">{p.name}</Link>
                    </td>
                    <td className="py-2">{p.driver.name}</td>
                    <td className="py-2">{p.vehicles.map((v) => v.vehicle.registrationNumber).join(", ")}</td>
                    <td className="py-2">{p.status}</td>
                    <td className="py-2">
                      {p.status === "DRAFT" && (
                        <button onClick={() => approve(p.id)} className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800">
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {policies.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">No vehicle-use policies configured</td>
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
