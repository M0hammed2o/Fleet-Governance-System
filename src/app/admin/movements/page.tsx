"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface MovementRow {
  id: string;
  referenceCode: string;
  movementType: string;
  status: string;
  destination: string | null;
  vehicle: { registrationNumber: string };
  driver: { name: string };
}

interface Option {
  id: string;
  label: string;
}

const STATUS_FILTERS = ["ALL", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "IN_PROGRESS", "COMPLETED"];
const MOVEMENT_TYPES = [
  "ENTRY",
  "EXIT",
  "DELIVERY",
  "COLLECTION",
  "RETURN",
  "SITE_TRANSFER",
  "MAINTENANCE",
  "OTHER",
  "SALES_VISIT",
  "SERVICE",
  "AUTHORISED_PRIVATE_USE",
];

export default function MovementsPage() {
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sites, setSites] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<Option[]>([]);
  const [drivers, setDrivers] = useState<Option[]>([]);
  const [form, setForm] = useState({
    siteId: "",
    vehicleId: "",
    driverId: "",
    movementType: "DELIVERY",
    destination: "",
    deliveryOrCollectionReference: "",
    senderName: "",
    recipientName: "",
  });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/movements", window.location.origin);
      if (statusFilter !== "ALL") url.searchParams.set("status", statusFilter);
      const [movementsRes, sitesRes, vehiclesRes, driversRes] = await Promise.all([
        fetch(url.toString()),
        fetch("/api/admin/sites"),
        fetch("/api/vehicles?pageSize=100"),
        fetch("/api/drivers?pageSize=100"),
      ]);
      const movementsData = await movementsRes.json();
      const sitesData = await sitesRes.json();
      const vehiclesData = await vehiclesRes.json();
      const driversData = await driversRes.json();
      if (!movementsRes.ok) throw new Error(movementsData.error ?? "Failed to load movements");

      setMovements(movementsData.items);
      setTotal(movementsData.total);
      if (sitesRes.ok) {
        const opts = sitesData.sites.map((s: { id: string; name: string }) => ({ id: s.id, label: s.name }));
        setSites(opts);
        setForm((f) => ({ ...f, siteId: f.siteId || opts[0]?.id || "" }));
      }
      if (vehiclesRes.ok) {
        const opts = vehiclesData.items.map((v: { id: string; registrationNumber: string }) => ({ id: v.id, label: v.registrationNumber }));
        setVehicles(opts);
        setForm((f) => ({ ...f, vehicleId: f.vehicleId || opts[0]?.id || "" }));
      }
      if (driversRes.ok) {
        const opts = driversData.items.map((d: { id: string; name: string }) => ({ id: d.id, label: d.name }));
        setDrivers(opts);
        setForm((f) => ({ ...f, driverId: f.driverId || opts[0]?.id || "" }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          destination: form.destination || undefined,
          deliveryOrCollectionReference: form.deliveryOrCollectionReference || undefined,
          senderName: form.senderName || undefined,
          recipientName: form.recipientName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create movement");
        return;
      }
      setForm((f) => ({ ...f, destination: "", deliveryOrCollectionReference: "", senderName: "", recipientName: "" }));
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Movement authorisations</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">New movement request</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select value={form.siteId} onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <select value={form.movementType} onChange={(e) => setForm((f) => ({ ...f, movementType: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            <select value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
            <input
              value={form.destination}
              onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
              placeholder="Destination"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              value={form.deliveryOrCollectionReference}
              onChange={(e) => setForm((f) => ({ ...f, deliveryOrCollectionReference: e.target.value }))}
              placeholder="Delivery/collection note #"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              value={form.senderName}
              onChange={(e) => setForm((f) => ({ ...f, senderName: e.target.value }))}
              placeholder="Sender name"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              value={form.recipientName}
              onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
              placeholder="Recipient name"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={creating || !form.siteId || !form.vehicleId || !form.driverId}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-2"
            >
              {creating ? "Creating…" : "Create draft"}
            </button>
          </form>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="text-sm text-slate-500">{total} total</span>
          </div>

          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Reference</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Vehicle</th>
                  <th className="pb-2">Driver</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <Link href={`/admin/movements/${m.id}`} className="font-mono text-xs text-slate-900 underline">
                        {m.referenceCode}
                      </Link>
                    </td>
                    <td className="py-2">{m.movementType}</td>
                    <td className="py-2">{m.vehicle.registrationNumber}</td>
                    <td className="py-2">{m.driver.name}</td>
                    <td className="py-2">{m.status}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">No movements found</td>
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
