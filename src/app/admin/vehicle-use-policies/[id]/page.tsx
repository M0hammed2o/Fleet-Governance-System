"use client";

import { useEffect, useState, useCallback, use } from "react";

interface Policy {
  id: string;
  name: string;
  status: string;
  driver: { name: string };
  vehicles: { vehicle: { registrationNumber: string } }[];
  approvingManager: { name: string } | null;
  approvedGeofence: { name: string } | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  permittedDaysOfWeek: number[];
  permittedStartTime: string | null;
  permittedEndTime: string | null;
  kmLimitPerTrip: number | null;
  kmLimitPerDay: number | null;
  kmLimitPerWeek: number | null;
  kmLimitPerMonth: number | null;
  allowAfterHours: boolean;
  allowWeekend: boolean;
  allowPrivateUse: boolean;
}

export default function VehicleUsePolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vehicle-use-policies/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load policy");
      setPolicy(data.policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function approve() {
    setError(null);
    const res = await fetch(`/api/vehicle-use-policies/${id}/approve`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to approve policy");
      return;
    }
    await load();
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (!policy) return <main className="p-8 text-sm text-red-700">{error ?? "Policy not found"}</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-900">{policy.name}</h1>
            <span className="text-sm font-medium text-slate-700">{policy.status}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Driver</dt>
            <dd>{policy.driver.name}</dd>
            <dt className="text-slate-500">Vehicles</dt>
            <dd>{policy.vehicles.map((v) => v.vehicle.registrationNumber).join(", ")}</dd>
            <dt className="text-slate-500">Effective from</dt>
            <dd>{new Date(policy.effectiveFrom).toLocaleDateString()}</dd>
            <dt className="text-slate-500">Effective to</dt>
            <dd>{policy.effectiveTo ? new Date(policy.effectiveTo).toLocaleDateString() : "—"}</dd>
            <dt className="text-slate-500">Approved geofence</dt>
            <dd>{policy.approvedGeofence?.name ?? "—"}</dd>
            <dt className="text-slate-500">Permitted hours</dt>
            <dd>{policy.permittedStartTime && policy.permittedEndTime ? `${policy.permittedStartTime}–${policy.permittedEndTime}` : "Any"}</dd>
            <dt className="text-slate-500">Km limit / trip</dt>
            <dd>{policy.kmLimitPerTrip ?? "—"}</dd>
            <dt className="text-slate-500">After-hours use</dt>
            <dd>{policy.allowAfterHours ? "Allowed" : "Not allowed"}</dd>
            <dt className="text-slate-500">Weekend use</dt>
            <dd>{policy.allowWeekend ? "Allowed" : "Not allowed"}</dd>
            <dt className="text-slate-500">Private use</dt>
            <dd>{policy.allowPrivateUse ? "Allowed" : "Not allowed"}</dd>
            <dt className="text-slate-500">Approving manager</dt>
            <dd>{policy.approvingManager?.name ?? "—"}</dd>
          </dl>

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {policy.status === "DRAFT" && (
            <button onClick={approve} className="mt-4 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
              Approve policy
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
