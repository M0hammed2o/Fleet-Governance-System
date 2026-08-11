"use client";

import { useCallback, useEffect, useState } from "react";

type ReadinessStatus = "READY" | "BLOCKED" | "NOT_CONFIGURED" | "MOCK_ONLY" | "MANUAL_CONFIRMATION_REQUIRED";

interface ReadinessItem {
  id: string;
  category: string;
  label: string;
  status: ReadinessStatus;
  codeReady: boolean;
  message: string;
}

interface DiagnosticsResponse {
  readiness: {
    generatedAt: string;
    environment: string;
    releaseReady: boolean;
    codeFoundationReady: boolean;
    summary: Record<ReadinessStatus, number>;
    items: ReadinessItem[];
  };
  jobs: Array<{
    name: string;
    cadence: string;
    owner: string;
    lastStatus: string | null;
    lastStartedAt: string | null;
  }>;
}

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  READY: "border-emerald-200 bg-emerald-50 text-emerald-800",
  BLOCKED: "border-red-200 bg-red-50 text-red-800",
  NOT_CONFIGURED: "border-slate-200 bg-slate-100 text-slate-700",
  MOCK_ONLY: "border-amber-200 bg-amber-50 text-amber-800",
  MANUAL_CONFIRMATION_REQUIRED: "border-indigo-200 bg-indigo-50 text-indigo-800",
};

function readableStatus(status: ReadinessStatus): string {
  return status.replaceAll("_", " ");
}

export default function PlatformReadinessPage() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/diagnostics", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load production diagnostics.");
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load production diagnostics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Platform operations</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">Production readiness</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Read-only configuration and dependency diagnostics. This page cannot connect a provider,
                deploy a release, run a migration, send a message or initiate a payment.
              </p>
            </div>
            <button onClick={load} disabled={loading} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {loading ? "Checking…" : "Refresh checks"}
            </button>
          </div>
        </header>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {loading && !data && <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Running safe read-only checks…</div>}

        {data && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Readiness status totals">
              {(Object.entries(data.readiness.summary) as Array<[ReadinessStatus, number]>).map(([status, count]) => (
                <div key={status} className={`rounded-lg border p-4 ${STATUS_STYLE[status]}`}>
                  <div className="text-2xl font-semibold">{count}</div>
                  <div className="mt-1 text-xs font-medium">{readableStatus(status)}</div>
                </div>
              ))}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-slate-950">Release decision</h2>
                <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${data.readiness.releaseReady ? STATUS_STYLE.READY : STATUS_STYLE.BLOCKED}`}>
                  {data.readiness.releaseReady ? "READY" : "NOT READY"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Environment: <strong>{data.readiness.environment}</strong> · Code foundations: {data.readiness.codeFoundationReady ? "complete" : "provider adapter blocked"} · Checked {new Date(data.readiness.generatedAt).toLocaleString()}
              </p>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              {data.readiness.items.map((entry) => (
                <article key={entry.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{entry.category}</p>
                      <h2 className="mt-1 font-semibold text-slate-950">{entry.label}</h2>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[entry.status]}`}>{readableStatus(entry.status)}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{entry.message}</p>
                </article>
              ))}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <h2 className="text-lg font-semibold text-slate-950">Scheduled-job health</h2>
              <p className="mt-1 text-sm text-slate-600">Configured cadence and latest local database run record; no schedule is created from this page.</p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="py-2 pr-4">Job</th><th className="py-2 pr-4">Cadence</th><th className="py-2 pr-4">Owner</th><th className="py-2 pr-4">Latest status</th><th className="py-2">Latest start</th></tr></thead>
                  <tbody>{data.jobs.map((job) => <tr key={job.name} className="border-b border-slate-100"><td className="py-3 pr-4 font-mono text-xs">{job.name}</td><td className="py-3 pr-4">{job.cadence}</td><td className="py-3 pr-4">{job.owner}</td><td className="py-3 pr-4">{job.lastStatus ?? "Never run"}</td><td className="py-3">{job.lastStartedAt ? new Date(job.lastStartedAt).toLocaleString() : "—"}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
