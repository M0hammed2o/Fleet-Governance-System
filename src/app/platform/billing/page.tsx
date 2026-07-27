"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface DashboardRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  subscriptionStatus: string;
  activeVehicleCount: number;
  currentPricing: { baseFeeMinorUnits: number; perVehicleFeeMinorUnits: number; currency: string; source: string };
  outstandingInvoiceTotalMinorUnits: number;
  overdueInvoiceCount: number;
  lastSuccessfulPaymentAt: string | null;
  failedPaymentAttemptCount: number;
  failedBillingEmailCount: number;
}

function formatMoney(minorUnits: number, currency = "ZAR"): string {
  const symbol = currency === "ZAR" ? "R" : `${currency} `;
  return `${symbol}${(minorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAST_DUE: "bg-amber-100 text-amber-800",
  SUSPENDED: "bg-red-100 text-red-800",
  CANCELLED: "bg-slate-200 text-slate-500",
};

export default function PlatformBillingDashboardPage() {
  const [rows, setRows] = useState<DashboardRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/billing/customers");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load billing dashboard");
      setRows(body.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const filtered = (rows ?? []).filter(
    (r) => r.tenantName.toLowerCase().includes(search.toLowerCase()) || r.tenantSlug.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Platform billing dashboard</h1>
        <p className="text-sm text-slate-500">Every client business, subscription status, pricing, invoices and payments (Phase 10).</p>

        <input
          type="text"
          placeholder="Search by name or slug"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-slate-500">Loading…</p>}

        {rows && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="p-3">Customer</th>
                  <th className="p-3">Subscription</th>
                  <th className="p-3">Active vehicles</th>
                  <th className="p-3">Current pricing</th>
                  <th className="p-3">Outstanding</th>
                  <th className="p-3">Overdue invoices</th>
                  <th className="p-3">Last payment</th>
                  <th className="p-3">Failed payments</th>
                  <th className="p-3">Failed emails</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.tenantId} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-900">
                      {row.tenantName}
                      <div className="text-xs font-normal text-slate-400">{row.tenantSlug}</div>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[row.subscriptionStatus] ?? "bg-slate-100 text-slate-700"}`}>
                        {row.subscriptionStatus}
                      </span>
                    </td>
                    <td className="p-3">{row.activeVehicleCount}</td>
                    <td className="p-3 text-xs">
                      {formatMoney(row.currentPricing.baseFeeMinorUnits, row.currentPricing.currency)} base + {formatMoney(row.currentPricing.perVehicleFeeMinorUnits, row.currentPricing.currency)}/vehicle
                      <div className="text-slate-400">{row.currentPricing.source === "TENANT_NEGOTIATED" ? "Negotiated" : "Platform default"}</div>
                    </td>
                    <td className="p-3">{formatMoney(row.outstandingInvoiceTotalMinorUnits)}</td>
                    <td className="p-3">{row.overdueInvoiceCount}</td>
                    <td className="p-3 text-xs text-slate-500">{row.lastSuccessfulPaymentAt ? new Date(row.lastSuccessfulPaymentAt).toLocaleDateString() : "Never"}</td>
                    <td className="p-3">{row.failedPaymentAttemptCount}</td>
                    <td className="p-3">{row.failedBillingEmailCount}</td>
                    <td className="p-3">
                      <Link href={`/platform/billing/${row.tenantId}`} className="text-sm text-slate-900 underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-6 text-center text-sm text-slate-500">
                      No customers match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
