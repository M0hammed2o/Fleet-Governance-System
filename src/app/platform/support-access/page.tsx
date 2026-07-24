"use client";

import { useEffect, useState, useCallback } from "react";

interface CustomerHealthSummary {
  tenant: { id: string; name: string; slug: string; status: string; subscriptionStatus: string };
  siteCount: number;
  gateCount: number;
  vehicleCount: number;
  userCount: number;
  openCriticalExceptionCount: number;
  gpsActiveVehicleCount: number;
  facialVerificationEnrolledDriverCount: number;
  storageUsageBytes: number;
  lastActivityAt: string | null;
  onboardingStatus: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default function PlatformSupportAccessPage() {
  const [customers, setCustomers] = useState<CustomerHealthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/support-access/customers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load customers");
      setCustomers(data.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function startSession(customerTenantId: string) {
    setError(null);
    const reasonText = reason[customerTenantId]?.trim();
    if (!reasonText) {
      setError("A reason is required to start a support-access session.");
      return;
    }
    setStarting(customerTenantId);
    try {
      const res = await fetch("/api/platform/support-access/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerTenantId, reason: reasonText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start support-access session");
        return;
      }
      window.location.href = `/platform/support-access/${customerTenantId}?sessionId=${data.accessSession.id}`;
    } finally {
      setStarting(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Customer health — support access</h1>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Onboarding</th>
                  <th className="pb-2">Sites/Gates/Vehicles/Users</th>
                  <th className="pb-2">Open critical</th>
                  <th className="pb-2">GPS active</th>
                  <th className="pb-2">Storage</th>
                  <th className="pb-2">Last activity</th>
                  <th className="pb-2">Start support session</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.tenant.id} className="border-b border-slate-100 align-top">
                    <td className="py-2">
                      <div className="font-medium text-slate-900">{c.tenant.name}</div>
                      <div className="text-xs text-slate-500">{c.tenant.status} · {c.tenant.subscriptionStatus}</div>
                    </td>
                    <td className="py-2">{c.onboardingStatus}</td>
                    <td className="py-2">{c.siteCount}/{c.gateCount}/{c.vehicleCount}/{c.userCount}</td>
                    <td className="py-2">
                      <span className={c.openCriticalExceptionCount > 0 ? "font-medium text-red-700" : ""}>{c.openCriticalExceptionCount}</span>
                    </td>
                    <td className="py-2">{c.gpsActiveVehicleCount}/{c.vehicleCount}</td>
                    <td className="py-2">{formatBytes(c.storageUsageBytes)}</td>
                    <td className="py-2">{c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleString() : "—"}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <input
                          value={reason[c.tenant.id] ?? ""}
                          onChange={(e) => setReason((r) => ({ ...r, [c.tenant.id]: e.target.value }))}
                          placeholder="Reason (required)"
                          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button
                          onClick={() => startSession(c.tenant.id)}
                          disabled={starting === c.tenant.id}
                          className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {starting === c.tenant.id ? "Starting…" : "Start"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-slate-400">No customer tenants found</td>
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
