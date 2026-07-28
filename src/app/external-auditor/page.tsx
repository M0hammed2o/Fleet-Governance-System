"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  outcome: string;
}

export default function ExternalAuditorPortalPage() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/external-auditor/cases");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setCases(data.cases);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">External auditor portal</h1>
        <p className="text-sm text-slate-500">Read-only access to exactly the cases you have been granted, for exactly the time you were granted them.</p>

        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Loading…</p>}
        {!loading && cases.length === 0 && !error && <p className="text-sm text-slate-400">No cases are currently accessible to you.</p>}

        <ul className="space-y-2">
          {cases.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <Link href={`/external-auditor/${c.id}`} className="font-mono text-blue-700 hover:underline">
                {c.caseNumber}
              </Link>
              <p className="text-sm text-slate-700">{c.title}</p>
              <p className="text-xs text-slate-500">
                Status: {c.status.replaceAll("_", " ")} — Outcome: {c.outcome.replaceAll("_", " ")}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
