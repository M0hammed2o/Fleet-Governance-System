"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface DashboardData {
  gateEventsToday: number;
  vehiclesClearedToday: number;
  vehiclesDeniedToday: number;
  eventsAwaitingApproval: number;
  openHighSeverityExceptions: number;
  failedInspectionItemsToday: number;
  gpsInactiveVehicles: { id: string; registrationNumber: string; fleetNumber: string | null; gpsLastCommunicationAt: string | null }[];
  expiringDocuments: {
    id: string;
    documentType: string;
    expiryDate: string | null;
    isExpired: boolean;
    configuredAction: string | null;
    ownerName: string;
    ownerType: string;
  }[];
  recentAuditActivity: { id: string; timestamp: string; action: string; entityType: string; entityId: string; userName: string }[];
}

function StatTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" | "danger" | "good" }) {
  const toneClasses: Record<string, string> = {
    default: "text-slate-900",
    warn: "text-amber-700",
    danger: "text-red-700",
    good: "text-emerald-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${toneClasses[tone]}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default function SecurityDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/security-dashboard");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load dashboard");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Security dashboard</h1>
          <Link href="/gate" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Go to gate
          </Link>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-slate-500">Loading…</p>}

        {data && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Gate events today" value={data.gateEventsToday} />
              <StatTile label="Vehicles cleared today" value={data.vehiclesClearedToday} tone="good" />
              <StatTile label="Vehicles denied today" value={data.vehiclesDeniedToday} tone="danger" />
              <StatTile label="Awaiting approval" value={data.eventsAwaitingApproval} tone="warn" />
              <StatTile label="Open high-severity exceptions" value={data.openHighSeverityExceptions} tone="danger" />
              <StatTile label="Failed inspection items today" value={data.failedInspectionItemsToday} tone="warn" />
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">GPS-inactive vehicles</h2>
                {data.gpsInactiveVehicles.length === 0 && <p className="text-sm text-slate-400">None — all vehicles reporting.</p>}
                <ul className="space-y-2 text-sm">
                  {data.gpsInactiveVehicles.map((v) => (
                    <li key={v.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span>{v.registrationNumber} {v.fleetNumber ? `(${v.fleetNumber})` : ""}</span>
                      <span className="text-xs text-slate-400">
                        {v.gpsLastCommunicationAt ? new Date(v.gpsLastCommunicationAt).toLocaleString() : "Never reported"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">Expiring / expired documents</h2>
                {data.expiringDocuments.length === 0 && <p className="text-sm text-slate-400">Nothing expiring within 30 days.</p>}
                <ul className="space-y-2 text-sm">
                  {data.expiringDocuments.map((d) => (
                    <li key={d.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span>
                        {d.ownerName} — {d.documentType.replaceAll("_", " ")}
                      </span>
                      <span className={`text-xs font-medium ${d.isExpired ? "text-red-600" : "text-amber-600"}`}>
                        {d.isExpired ? "Expired" : "Expiring"} {d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : ""}
                        {d.configuredAction ? ` · ${d.configuredAction.replaceAll("_", " ")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent audit activity</h2>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="pb-2">When</th>
                    <th className="pb-2">Actor</th>
                    <th className="pb-2">Action</th>
                    <th className="pb-2">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentAuditActivity.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100">
                      <td className="py-2 text-xs text-slate-500">{new Date(a.timestamp).toLocaleString()}</td>
                      <td className="py-2">{a.userName}</td>
                      <td className="py-2 font-mono text-xs">{a.action}</td>
                      <td className="py-2 text-xs text-slate-500">{a.entityType} #{a.entityId.slice(-6)}</td>
                    </tr>
                  ))}
                  {data.recentAuditActivity.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-400">No recent activity</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
