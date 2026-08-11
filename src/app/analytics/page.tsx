"use client";

import Link from "next/link";
import { cloneElement, useCallback, useEffect, useMemo, useState } from "react";

type Option = { id: string; name?: string; registrationNumber?: string; siteId?: string };
type Dashboard = {
  tenant: { name: string; timezone: string };
  period: { startDate: string; endDate: string };
  capabilities: { canExport: boolean; canCalculate: boolean; canReview: boolean; canConfigure: boolean };
  calculation: { status: string; finishedAt: string | null; startedAt: string; dataQuality: string } | null;
  dataQuality: { status: string; statement: string; queryTruncated: boolean };
  executive: Record<string, string | number | null>;
  operational: {
    movementsByDay: Array<{ period: string; count: number }>;
    gateVolumesByDay: Array<{ period: string; count: number }>;
    inspectionFailuresByCategory: Array<{ category: string; count: number }>;
    discrepanciesByCategory: Array<{ category: string; count: number }>;
    [key: string]: unknown;
  };
  investigations: { byStatus: Record<string, number>; byOutcome: Record<string, number>; confidentialityStatement: string; [key: string]: unknown };
  tracking: { dataQuality: string; sourceLabels: string[]; latestTrackingTimestamp: string | null; limitation: string; trackedVehicleCount: number; staleOrUnavailableCount: number };
  indicators: Array<{ id: string; title: string; severity: string; status: string; subjectType: string; subjectLabel: string; occurrenceCount: number; dataQuality: string; lastDetectedAt: string }>;
};

const initialFilters = { startDate: "", endDate: "", siteId: "", gateId: "", vehicleId: "", driverId: "", movementType: "", department: "", severity: "", exceptionStatus: "", investigationStatus: "" };

function title(value: string) {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/(^|\s)\S/g, (part) => part.toUpperCase());
}

function qualityStyle(status: string) {
  if (status === "COMPLETE") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "MOCK" || status === "MANUAL" || status === "MIXED") return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-red-300 bg-red-50 text-red-950";
}

function severityStyle(severity: string) {
  return severity === "CRITICAL" ? "bg-red-100 text-red-900" : severity === "HIGH" ? "bg-orange-100 text-orange-900" : severity === "MEDIUM" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-800";
}

function metricValue(key: string, value: string | number | null) {
  if (value == null) return "—";
  if (/time$/i.test(key) && typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toLocaleString();
  return String(value);
}

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

export default function GovernanceAnalyticsPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [options, setOptions] = useState<{ sites: Option[]; gates: Option[]; vehicles: Option[]; drivers: Option[] }>({ sites: [], gates: [], vehicles: [], drivers: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(appliedFilters).forEach(([key, value]) => value && params.set(key, value));
    return params.toString();
  }, [appliedFilters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = await jsonFetch(`/api/analytics/dashboard${query ? `?${query}` : ""}`);
      setDashboard(body.dashboard);
      if (!appliedFilters.startDate && !appliedFilters.endDate) {
        setFilters((current) => ({ ...current, startDate: body.dashboard.period.startDate, endDate: body.dashboard.period.endDate }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load governance analytics.");
    } finally {
      setLoading(false);
    }
  }, [query, appliedFilters.startDate, appliedFilters.endDate]);

  useEffect(() => { queueMicrotask(load); }, [load]);
  useEffect(() => {
    Promise.allSettled([
      jsonFetch("/api/admin/sites"),
      jsonFetch("/api/admin/gates"),
      jsonFetch("/api/vehicles?pageSize=100"),
      jsonFetch("/api/drivers?pageSize=100"),
    ]).then(([sites, gates, vehicles, drivers]) => setOptions({
      sites: sites.status === "fulfilled" ? sites.value.sites ?? [] : [],
      gates: gates.status === "fulfilled" ? gates.value.gates ?? [] : [],
      vehicles: vehicles.status === "fulfilled" ? vehicles.value.items ?? [] : [],
      drivers: drivers.status === "fulfilled" ? drivers.value.items ?? [] : [],
    }));
  }, []);

  async function calculate() {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = await jsonFetch("/api/analytics/calculate", { method: "POST" });
      setMessage(`Calculation completed: ${body.result?.indicatorsCreated ?? 0} created, ${body.result?.indicatorsUpdated ?? 0} updated, ${body.result?.indicatorsSuppressed ?? 0} duplicate/cooldown results suppressed.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Calculation failed."); }
    finally { setBusy(false); }
  }

  async function generateReport() {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = await jsonFetch("/api/analytics/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(Object.entries(appliedFilters).filter(([, value]) => value))) });
      const download = await jsonFetch(`/api/analytics/reports/${body.report.id}/download`);
      setMessage("Governance analytics report generated. The signed download is opening now.");
      window.open(download.url, "_blank", "noopener,noreferrer");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Report generation failed."); }
    finally { setBusy(false); }
  }

  const activeFilterCount = Object.values(appliedFilters).filter(Boolean).length;
  const operationalMetrics = dashboard ? Object.entries(dashboard.operational).filter(([, value]) => !Array.isArray(value) && (typeof value === "number" || value === null)) as Array<[string, number | null]> : [];
  const investigationMetrics = dashboard ? Object.entries(dashboard.investigations).filter(([, value]) => typeof value === "number" || value === null) as Array<[string, number | null]> : [];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Governance intelligence</p>
            <h1 className="text-2xl font-semibold">Executive analytics</h1>
            <p className="mt-1 text-sm text-slate-300">Explainable patterns for authorised human review — never automated accusations.</p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="Analytics navigation">
            <Link href="/investigations" className="rounded border border-slate-600 px-3 py-2 hover:bg-slate-800">Investigations</Link>
            {dashboard?.capabilities.canConfigure && <Link href="/analytics/rules" className="rounded border border-slate-600 px-3 py-2 hover:bg-slate-800">Rule configuration</Link>}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="filter-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="filter-heading" className="font-semibold">Reporting filters</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{activeFilterCount} active</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Filter label="Start date"><input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} /></Filter>
            <Filter label="End date"><input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} /></Filter>
            <Filter label="Site"><select value={filters.siteId} onChange={(event) => setFilters({ ...filters, siteId: event.target.value, gateId: "" })}><option value="">All sites</option>{options.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Filter>
            <Filter label="Gate"><select value={filters.gateId} onChange={(event) => setFilters({ ...filters, gateId: event.target.value })}><option value="">All gates</option>{options.gates.filter((item) => !filters.siteId || item.siteId === filters.siteId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Filter>
            <Filter label="Vehicle"><select value={filters.vehicleId} onChange={(event) => setFilters({ ...filters, vehicleId: event.target.value })}><option value="">All vehicles</option>{options.vehicles.map((item) => <option key={item.id} value={item.id}>{item.registrationNumber}</option>)}</select></Filter>
            <Filter label="Driver"><select value={filters.driverId} onChange={(event) => setFilters({ ...filters, driverId: event.target.value })}><option value="">All drivers</option>{options.drivers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Filter>
            <Filter label="Movement type"><select value={filters.movementType} onChange={(event) => setFilters({ ...filters, movementType: event.target.value })}><option value="">All movement types</option>{["ENTRY", "EXIT", "DELIVERY", "COLLECTION", "RETURN", "SITE_TRANSFER", "MAINTENANCE", "SALES_VISIT", "SERVICE", "AUTHORISED_PRIVATE_USE", "OTHER"].map((item) => <option key={item}>{title(item)}</option>)}</select></Filter>
            <Filter label="Department or unit"><input value={filters.department} maxLength={200} placeholder="All departments" onChange={(event) => setFilters({ ...filters, department: event.target.value })} /></Filter>
            <Filter label="Exception severity"><select value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}><option value="">All severities</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((item) => <option key={item}>{item}</option>)}</select></Filter>
            <Filter label="Exception status"><select value={filters.exceptionStatus} onChange={(event) => setFilters({ ...filters, exceptionStatus: event.target.value })}><option value="">All exception statuses</option><option>OPEN</option><option>RESOLVED</option></select></Filter>
            <Filter label="Investigation status"><select value={filters.investigationStatus} onChange={(event) => setFilters({ ...filters, investigationStatus: event.target.value })}><option value="">All investigation statuses</option>{["DRAFT", "OPEN", "TRIAGE", "UNDER_INVESTIGATION", "AWAITING_INFORMATION", "AWAITING_APPROVAL", "CLOSED", "REOPENED"].map((item) => <option key={item}>{title(item)}</option>)}</select></Filter>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={loading} onClick={() => setAppliedFilters(filters)}>Apply filters</button>
            <button className="rounded border border-slate-300 px-4 py-2 text-sm" onClick={() => { setFilters(initialFilters); setAppliedFilters(initialFilters); }}>Reset</button>
            {dashboard?.capabilities.canCalculate && <button className="rounded border border-cyan-700 px-4 py-2 text-sm text-cyan-800 disabled:opacity-50" disabled={busy} onClick={() => void calculate()}>Calculate indicators</button>}
            {dashboard?.capabilities.canExport && <a className="rounded border border-slate-300 px-4 py-2 text-sm" href={`/api/analytics/exports/csv${query ? `?${query}` : ""}`}>Export filtered CSV</a>}
            {dashboard?.capabilities.canExport && <button className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => void generateReport()}>Generate PDF report</button>}
          </div>
        </section>

        {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
        {message && <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</div>}
        {loading && <div role="status" className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">Calculating tenant-scoped dashboard metrics…</div>}

        {dashboard && !loading && <>
          <section className={`rounded-xl border p-4 ${qualityStyle(dashboard.dataQuality.status)}`} aria-labelledby="quality-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="quality-heading" className="font-semibold">Data quality: {title(dashboard.dataQuality.status)}</h2>
              <span className="text-xs font-semibold">{dashboard.period.startDate}–{dashboard.period.endDate} · {dashboard.tenant.timezone}</span>
            </div>
            <p className="mt-1 text-sm">{dashboard.dataQuality.statement}</p>
            <p className="mt-1 text-xs">Latest calculation: {dashboard.calculation?.finishedAt ? new Date(dashboard.calculation.finishedAt).toLocaleString() : "Not yet calculated"}</p>
          </section>

          <section aria-labelledby="summary-heading">
            <h2 id="summary-heading" className="mb-3 text-lg font-semibold">Executive governance summary</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {Object.entries(dashboard.executive).map(([key, value]) => <article key={key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{title(key)}</p><p className="mt-2 break-words text-2xl font-semibold">{metricValue(key, value)}</p></article>)}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2" aria-label="Operational trends">
            <Trend title="Authorised movements by day" rows={dashboard.operational.movementsByDay} />
            <Trend title="Gate volume by day" rows={dashboard.operational.gateVolumesByDay} />
          </section>

          <section aria-labelledby="operational-measures-heading"><h2 id="operational-measures-heading" className="mb-3 text-lg font-semibold">Operational measures</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{operationalMetrics.map(([key, value]) => <article key={key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{title(key)}</p><p className="mt-2 text-xl font-semibold">{value == null ? "Unavailable" : String(value)}</p></article>)}</div>{typeof dashboard.operational.inspectionTimingStatement === "string" && <p className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">{dashboard.operational.inspectionTimingStatement}</p>}</section>

          <section className="grid gap-4 lg:grid-cols-4">
            <Breakdown title="Inspection failures" rows={dashboard.operational.inspectionFailuresByCategory} />
            <Breakdown title="Data inconsistencies" rows={dashboard.operational.discrepanciesByCategory} />
            <Breakdown title="Investigation status" rows={Object.entries(dashboard.investigations.byStatus).map(([category, count]) => ({ category, count }))} />
            <Breakdown title="Investigation outcomes" rows={Object.entries(dashboard.investigations.byOutcome).map(([category, count]) => ({ category, count }))} />
          </section>

          <section aria-labelledby="investigation-measures-heading"><h2 id="investigation-measures-heading" className="mb-3 text-lg font-semibold">Aggregated investigation measures</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{investigationMetrics.map(([key, value]) => <article key={key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{title(key)}</p><p className="mt-2 text-xl font-semibold">{value == null ? "Unavailable" : String(value)}</p></article>)}</div></section>

          <section className={`rounded-xl border p-4 ${qualityStyle(dashboard.tracking.dataQuality)}`} aria-labelledby="tracking-heading">
            <h2 id="tracking-heading" className="font-semibold">Tracker-data transparency</h2>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3"><p>Sources: <strong>{dashboard.tracking.sourceLabels.join(", ") || "Unavailable"}</strong></p><p>Tracked vehicles: <strong>{dashboard.tracking.trackedVehicleCount}</strong></p><p>Stale/unavailable: <strong>{dashboard.tracking.staleOrUnavailableCount}</strong></p></div>
            <p className="mt-2 text-sm">{dashboard.tracking.limitation}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="indicator-heading">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4"><div><h2 id="indicator-heading" className="font-semibold">Risk indicators</h2><p className="text-xs text-slate-500">Deterministic patterns requiring authorised review.</p></div><span className="text-sm text-slate-500">{dashboard.indicators.length} shown</span></div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Indicator</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Data quality</th></tr></thead><tbody className="divide-y divide-slate-100">{dashboard.indicators.map((item) => <tr key={item.id}><td className="px-4 py-3"><Link href={`/analytics/indicators/${item.id}`} className="font-medium text-cyan-800 hover:underline">{item.title}</Link><p className="text-xs text-slate-500">{item.occurrenceCount} occurrence(s)</p></td><td className="px-4 py-3">{title(item.subjectType)} · {item.subjectLabel}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${severityStyle(item.severity)}`}>{item.severity}</span></td><td className="px-4 py-3">{title(item.status)}</td><td className="px-4 py-3">{title(item.dataQuality)}</td></tr>)}</tbody></table>
              {dashboard.indicators.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No persisted indicators match this reporting period. An empty result does not prove that no governance issue exists.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><h2 className="font-semibold text-slate-900">Investigation analytics confidentiality</h2><p className="mt-1">{dashboard.investigations.confidentialityStatement}</p></section>
        </>}
      </div>
    </main>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) {
  return <label className="text-xs font-medium text-slate-600">{label}{cloneElement(children, { "aria-label": label, className: "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900" } as { className: string })}</label>;
}

function Trend({ title: heading, rows }: { title: string; rows: Array<{ period: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-semibold">{heading}</h2>{rows.length === 0 ? <p className="mt-6 text-sm text-slate-500">No records in this period.</p> : <div className="mt-4 space-y-2">{rows.slice(-14).map((row) => <div key={row.period} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-xs"><span>{row.period}</span><div className="h-3 rounded bg-slate-100" aria-hidden="true"><div className="h-3 rounded bg-cyan-600" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} /></div><strong>{row.count}</strong></div>)}</div>}</section>;
}

function Breakdown({ title: heading, rows }: { title: string; rows: Array<{ category: string; count: number }> }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-semibold">{heading}</h2><ul className="mt-3 space-y-2 text-sm">{rows.map((row) => <li key={row.category} className="flex justify-between gap-3"><span>{title(row.category)}</span><strong>{row.count}</strong></li>)}{rows.length === 0 && <li className="text-slate-500">No matching records.</li>}</ul></section>;
}
