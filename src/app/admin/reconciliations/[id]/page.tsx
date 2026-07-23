"use client";

import { useEffect, useState, useCallback, use } from "react";

interface InspectionResult {
  id: string;
  outcome: string;
  readingValue: string | null;
  readingUnit: string | null;
  inspectionItem: { label: string; section: string };
}

interface GateEventSide {
  id: string;
  direction: string;
  completedAt: string | null;
  gate: { name: string };
  securityOfficer: { name: string };
  inspectionResults: InspectionResult[];
}

interface Discrepancy {
  id: string;
  category: string;
  severity: string;
  description: string;
  departureValue: string | null;
  returnValue: string | null;
  deltaValue: number | null;
  status: string;
  resolutionNotes: string | null;
  correctiveAction: string | null;
  resolvedBy: { name: string } | null;
  linkedException: { id: string } | null;
}

interface Reconciliation {
  id: string;
  status: string;
  departureOdometer: number | null;
  returnOdometer: number | null;
  kmTravelled: number | null;
  departureFuelPercent: number | null;
  returnFuelPercent: number | null;
  fuelDeltaPercent: number | null;
  movementAuthorisation: { referenceCode: string; vehicle: { registrationNumber: string }; driver: { name: string } };
  departureGateEvent: GateEventSide;
  returnGateEvent: GateEventSide;
  discrepancies: Discrepancy[];
}

function GateEventPanel({ title, event }: { title: string; event: GateEventSide }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Gate</dt>
        <dd>{event.gate.name}</dd>
        <dt className="text-slate-500">Officer</dt>
        <dd>{event.securityOfficer.name}</dd>
        <dt className="text-slate-500">Completed</dt>
        <dd>{event.completedAt ? new Date(event.completedAt).toLocaleString() : "—"}</dd>
      </dl>
      <ul className="mt-3 space-y-1 text-xs">
        {event.inspectionResults.map((r) => (
          <li key={r.id} className="flex justify-between border-b border-slate-100 py-1">
            <span className="text-slate-500">{r.inspectionItem.label}</span>
            <span className="font-medium text-slate-900">
              {r.readingValue ? `${r.readingValue}${r.readingUnit ?? ""}` : r.outcome}
            </span>
          </li>
        ))}
        {event.inspectionResults.length === 0 && <li className="text-slate-400">No inspection results recorded</li>}
      </ul>
    </div>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "text-slate-600",
  MEDIUM: "text-amber-700",
  HIGH: "text-red-700",
  CRITICAL: "text-red-900 font-semibold",
};

export default function ReconciliationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [actionById, setActionById] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reconciliations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load reconciliation");
      setReconciliation(data.reconciliation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function resolve(discrepancyId: string) {
    setError(null);
    const resolutionNotes = notesById[discrepancyId]?.trim();
    if (!resolutionNotes) {
      setError("A resolution explanation is required.");
      return;
    }
    setResolving(discrepancyId);
    try {
      const res = await fetch(`/api/reconciliations/discrepancies/${discrepancyId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNotes, correctiveAction: actionById[discrepancyId] || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to resolve discrepancy");
        return;
      }
      await load();
    } finally {
      setResolving(null);
    }
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (!reconciliation) return <main className="p-8 text-sm text-red-700">{error ?? "Reconciliation not found"}</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="font-mono text-lg font-semibold text-slate-900">{reconciliation.movementAuthorisation.referenceCode}</h1>
            <span className="text-sm font-medium text-slate-700">{reconciliation.status}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <dt className="text-slate-500">Vehicle</dt>
            <dd>{reconciliation.movementAuthorisation.vehicle.registrationNumber}</dd>
            <dt className="text-slate-500">Driver</dt>
            <dd>{reconciliation.movementAuthorisation.driver.name}</dd>
            <dt className="text-slate-500">Odometer</dt>
            <dd>{reconciliation.departureOdometer ?? "—"} → {reconciliation.returnOdometer ?? "—"} ({reconciliation.kmTravelled ?? "—"} km)</dd>
            <dt className="text-slate-500">Fuel</dt>
            <dd>{reconciliation.departureFuelPercent ?? "—"}% → {reconciliation.returnFuelPercent ?? "—"}%</dd>
          </dl>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <GateEventPanel title="Departure" event={reconciliation.departureGateEvent} />
          <GateEventPanel title="Return" event={reconciliation.returnGateEvent} />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Discrepancies</h2>
          {reconciliation.discrepancies.length === 0 && (
            <p className="text-sm text-slate-500">No discrepancies found — departure and return match.</p>
          )}
          <ul className="space-y-4">
            {reconciliation.discrepancies.map((d) => (
              <li key={d.id} className="rounded-md border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase text-slate-500">{d.category}</span>
                  <span className={`text-xs font-medium ${SEVERITY_STYLES[d.severity] ?? "text-slate-600"}`}>{d.severity}</span>
                </div>
                <p className="mt-1 text-sm text-slate-900">{d.description}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Departure: {d.departureValue ?? "—"} · Return: {d.returnValue ?? "—"}
                  {d.deltaValue != null && ` · Δ ${d.deltaValue}`}
                </p>
                {d.linkedException && (
                  <p className="mt-1 text-xs text-red-700">Exception raised — requires supervisor review.</p>
                )}

                {d.status === "OPEN" ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={notesById[d.id] ?? ""}
                      onChange={(e) => setNotesById((s) => ({ ...s, [d.id]: e.target.value }))}
                      placeholder="Explanation (required)"
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      value={actionById[d.id] ?? ""}
                      onChange={(e) => setActionById((s) => ({ ...s, [d.id]: e.target.value }))}
                      placeholder="Corrective action (optional)"
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => resolve(d.id)}
                      disabled={resolving === d.id}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {resolving === d.id ? "Resolving…" : "Resolve"}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <p>Resolved by {d.resolvedBy?.name ?? "—"}: {d.resolutionNotes}</p>
                    {d.correctiveAction && <p className="mt-1">Corrective action: {d.correctiveAction}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
