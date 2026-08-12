"use client";

import { useEffect, useState, useCallback, use } from "react";
import { ComplianceDocumentsPanel, type ComplianceDocument } from "@/components/compliance-documents-panel";

interface Vehicle {
  id: string;
  registrationNumber: string;
  fleetNumber: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  category: string;
  operationalStatus: "OPERATIONAL" | "WORKSHOP_LOCKOUT" | "SECURITY_LOCKOUT" | "DECOMMISSIONED";
  odometerReading: number | null;
  fuelLevelPercent: number | null;
  gpsStatus: string;
  licenceDiscExpiry: string | null;
  roadworthyExpiry: string | null;
  insuranceExpiry: string | null;
  assignedDriver: { id: string; name: string } | null;
  tyrePositionConfig: { name: string; positions: { id: string; code: string; label: string }[] } | null;
  tyres: { positionDefinitionId: string; brand: string | null; size: string | null }[];
}

interface TrackerDataSummary { kind: string; label: string; warning: string }

const STATUS_OPTIONS = ["OPERATIONAL", "WORKSHOP_LOCKOUT", "SECURITY_LOCKOUT", "DECOMMISSIONED"] as const;

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [documents, setDocuments] = useState<ComplianceDocument[]>([]);
  const [trackerDataSummary, setTrackerDataSummary] = useState<TrackerDataSummary>({ kind: "UNAVAILABLE", label: "Tracker data unavailable", warning: "Missing tracker data is not proof of misconduct." });
  const [trackerMappingStatus, setTrackerMappingStatus] = useState("UNMAPPED");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vehicles/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load vehicle");
      setVehicle(data.vehicle);
      setDocuments(data.documents);
      setTrackerDataSummary(data.trackerDataSummary);
      setTrackerMappingStatus(data.trackerMappingStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function setStatus(operationalStatus: (typeof STATUS_OPTIONS)[number]) {
    setError(null);
    const res = await fetch(`/api/vehicles/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationalStatus }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to update status");
      return;
    }
    await load();
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (!vehicle) return <main className="p-8 text-sm text-red-700">{error ?? "Vehicle not found"}</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">{vehicle.registrationNumber}</h1>
              <p className="text-sm text-slate-500">
                {vehicle.fleetNumber ?? "No fleet number"} — {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unknown make/model"}
              </p>
            </div>
            <span className={vehicle.operationalStatus === "OPERATIONAL" ? "text-emerald-700" : "text-red-700"}>
              {vehicle.operationalStatus}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">VIN</dt>
            <dd>{vehicle.vin ?? "—"}</dd>
            <dt className="text-slate-500">Category</dt>
            <dd>{vehicle.category}</dd>
            <dt className="text-slate-500">Assigned driver</dt>
            <dd>{vehicle.assignedDriver?.name ?? "—"}</dd>
            <dt className="text-slate-500">Odometer</dt>
            <dd>{vehicle.odometerReading ?? "—"}</dd>
            <dt className="text-slate-500">Fuel level</dt>
            <dd>{vehicle.fuelLevelPercent != null ? `${vehicle.fuelLevelPercent}%` : "—"}</dd>
            <dt className="text-slate-500">GPS status</dt>
            <dd>{vehicle.gpsStatus}</dd>
            <dt className="text-slate-500">Tracker source</dt>
            <dd className={trackerDataSummary.kind === "SYNTHETIC" ? "font-semibold text-amber-800" : "font-medium"}>{trackerDataSummary.label}</dd>
            <dt className="text-slate-500">Mapping status</dt>
            <dd>{trackerMappingStatus}</dd>
            <dt className="text-slate-500">Licence disc expiry</dt>
            <dd>{vehicle.licenceDiscExpiry ? new Date(vehicle.licenceDiscExpiry).toLocaleDateString() : "—"}</dd>
            <dt className="text-slate-500">Roadworthy expiry</dt>
            <dd>{vehicle.roadworthyExpiry ? new Date(vehicle.roadworthyExpiry).toLocaleDateString() : "—"}</dd>
            <dt className="text-slate-500">Insurance expiry</dt>
            <dd>{vehicle.insuranceExpiry ? new Date(vehicle.insuranceExpiry).toLocaleDateString() : "—"}</dd>
          </dl>

          <p role="status" className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{trackerDataSummary.warning}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {STATUS_OPTIONS.filter((s) => s !== vehicle.operationalStatus).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                Set {s.replace(/_/g, " ").toLowerCase()}
              </button>
            ))}
          </div>

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <ComplianceDocumentsPanel ownerType="VEHICLE" ownerId={vehicle.id} documents={documents} onChanged={load} />

        {vehicle.tyrePositionConfig && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Tyres — {vehicle.tyrePositionConfig.name}</h2>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {vehicle.tyrePositionConfig.positions.map((pos) => {
                const tyre = vehicle.tyres.find((t) => t.positionDefinitionId === pos.id);
                return (
                  <li key={pos.id} className="rounded-md border border-slate-100 p-2">
                    <div className="font-medium text-slate-700">{pos.label}</div>
                    <div className="text-slate-500">{tyre ? `${tyre.brand ?? "—"} ${tyre.size ?? ""}` : "No data"}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
