"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface MovementResult {
  id: string;
  referenceCode: string;
  movementType: string;
  status: string;
  destination: string | null;
  deliveryOrCollectionReference: string | null;
  purchaseOrderReference: string | null;
  approvedCargoSummary: string | null;
  sealOrContainerReference: string | null;
  vehicle: { registrationNumber: string; fleetNumber: string | null };
  driver: { name: string };
  trailerVehicle: { registrationNumber: string } | null;
  site: { name: string };
}

interface GateOption {
  id: string;
  name: string;
  direction: "ENTRY" | "EXIT" | "BOTH";
}

/**
 * Tablet-friendly gate lookup + check-in start (build brief 7.5 "gate-facing
 * lookup", GATE item 6 "one connected flow, not disconnected pages"). The
 * lookup itself stays read-only against the movement record — starting a
 * gate event doesn't edit the movement, it creates a new GateEvent that
 * references it. Once started, the officer is taken straight into the guided
 * flow at /gate/events/[id].
 */
export default function GateLookupPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovementResult[]>([]);
  const [selected, setSelected] = useState<MovementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gates, setGates] = useState<GateOption[]>([]);
  const [gateId, setGateId] = useState("");
  const [direction, setDirection] = useState<"ENTRY" | "EXIT">("ENTRY");
  const [starting, setStarting] = useState(false);

  const loadGates = useCallback(async () => {
    const res = await fetch("/api/admin/gates");
    if (!res.ok) return;
    const data = await res.json();
    const opts: GateOption[] = data.gates.map((g: { id: string; name: string; direction: string }) => ({
      id: g.id,
      name: g.name,
      direction: g.direction,
    }));
    setGates(opts);
    setGateId((current) => current || opts[0]?.id || "");
  }, []);

  useEffect(() => {
    queueMicrotask(loadGates);
  }, [loadGates]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSelected(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/gate/movements/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.movements);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartGateEvent() {
    if (!selected || !gateId) return;
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/gate/gate-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movementAuthorisationId: selected.id, gateId, direction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start gate event");
      router.push(`/gate/events/${data.gateEvent.id}`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Failed to start gate event");
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Find approved movement</h1>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Registration, fleet #, driver, reference…"
            autoFocus
            className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-lg"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-slate-900 px-6 py-3 text-lg font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Search
          </button>
        </form>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {!selected && results.length > 0 && (
          <ul className="space-y-2">
            {results.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setSelected(m)}
                  className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-400"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-slate-900">{m.vehicle.registrationNumber}</span>
                    <span className="font-mono text-sm text-slate-500">{m.referenceCode}</span>
                  </div>
                  <div className="text-sm text-slate-600">
                    {m.driver.name} — {m.movementType} — <span className="font-medium">{m.status}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!loading && !error && results.length === 0 && query && (
          <p className="text-sm text-slate-500">No matching approved movement found.</p>
        )}

        {selected && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <button onClick={() => setSelected(null)} className="mb-4 text-sm text-slate-500 underline">
              ← Back to results
            </button>

            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">{selected.vehicle.registrationNumber}</h2>
              <span
                className={
                  "rounded-full px-3 py-1 text-sm font-semibold " +
                  (selected.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")
                }
              >
                {selected.status}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-base">
              <dt className="text-slate-500">Driver</dt>
              <dd className="font-medium">{selected.driver.name}</dd>
              <dt className="text-slate-500">Fleet #</dt>
              <dd>{selected.vehicle.fleetNumber ?? "—"}</dd>
              <dt className="text-slate-500">Trailer</dt>
              <dd>{selected.trailerVehicle?.registrationNumber ?? "—"}</dd>
              <dt className="text-slate-500">Site</dt>
              <dd>{selected.site.name}</dd>
              <dt className="text-slate-500">Type</dt>
              <dd>{selected.movementType}</dd>
              <dt className="text-slate-500">Destination</dt>
              <dd>{selected.destination ?? "—"}</dd>
              <dt className="text-slate-500">Delivery/collection ref</dt>
              <dd>{selected.deliveryOrCollectionReference ?? "—"}</dd>
              <dt className="text-slate-500">Purchase order ref</dt>
              <dd>{selected.purchaseOrderReference ?? "—"}</dd>
              <dt className="text-slate-500">Approved cargo</dt>
              <dd>{selected.approvedCargoSummary ?? "—"}</dd>
              <dt className="text-slate-500">Seal/container ref</dt>
              <dd>{selected.sealOrContainerReference ?? "—"}</dd>
            </dl>

            {selected.status !== "APPROVED" && (
              <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This movement is not yet approved — do not clear this vehicle on the strength of this
                record alone.
              </p>
            )}

            {selected.status === "APPROVED" && (
              <div className="mt-6 space-y-3 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-900">Start gate check-in</h3>
                <div className="flex gap-2">
                  <select
                    value={gateId}
                    onChange={(e) => setGateId(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-3 text-base"
                  >
                    {gates.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as "ENTRY" | "EXIT")}
                    className="rounded-lg border border-slate-300 px-3 py-3 text-base"
                  >
                    <option value="ENTRY">Entry</option>
                    <option value="EXIT">Exit</option>
                  </select>
                </div>
                <button
                  onClick={handleStartGateEvent}
                  disabled={starting || !gateId}
                  className="w-full rounded-lg bg-emerald-700 px-6 py-4 text-lg font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {starting ? "Starting…" : "Start gate check-in"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
