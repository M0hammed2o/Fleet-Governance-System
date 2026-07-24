"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface SupportView {
  tenant: { id: string; name: string; slug: string; status: string; subscriptionStatus: string };
  sites: { id: string; name: string }[];
  gates: { id: string; name: string; siteName: string }[];
  vehicleCount: number;
  driverCount: number;
  openExceptions: { id: string; severity: string; description: string; raisedAt: string }[];
  recentMovements: { id: string; referenceCode: string; status: string; movementType: string; createdAt: string }[];
  notes: { id: string; note: string; authorName: string; createdAt: string }[];
}

export default function SupportViewPage({ params }: { params: Promise<{ customerTenantId: string }> }) {
  const { customerTenantId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("sessionId");

  const [view, setView] = useState<SupportView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [elevateReason, setElevateReason] = useState("");
  const [elevated, setElevated] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/support-access/customers/${customerTenantId}/view`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No active support-access session — start one from the customer list first.");
      setView(data.view);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [customerTenantId]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/platform/support-access/customers/${customerTenantId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: noteText }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to add note");
      return;
    }
    setNoteText("");
    await load();
  }

  async function elevate() {
    if (!sessionId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/support-access/sessions/${sessionId}/elevate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elevatedReason: elevateReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to elevate session");
        return;
      }
      setElevated(true);
    } finally {
      setBusy(false);
    }
  }

  async function exitSession() {
    if (!sessionId) {
      router.push("/platform/support-access");
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/platform/support-access/sessions/${sessionId}/end`, { method: "POST" });
    } finally {
      router.push("/platform/support-access");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Support view — {view?.tenant.name ?? "…"} {elevated && <span className="ml-2 rounded bg-amber-200 px-2 py-0.5 text-xs">ELEVATED</span>}
            </p>
            <p className="text-xs text-amber-800">Read-only by default. All access is audited.</p>
          </div>
          <button onClick={exitSession} disabled={busy} className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100">
            Exit support view
          </button>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-slate-500">Loading…</p>}

        {view && (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Overview</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <dt className="text-slate-500">Sites</dt>
                <dd>{view.sites.length}</dd>
                <dt className="text-slate-500">Gates</dt>
                <dd>{view.gates.length}</dd>
                <dt className="text-slate-500">Vehicles</dt>
                <dd>{view.vehicleCount}</dd>
                <dt className="text-slate-500">Drivers</dt>
                <dd>{view.driverCount}</dd>
              </dl>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Open exceptions</h2>
              <ul className="space-y-1 text-sm">
                {view.openExceptions.map((e) => (
                  <li key={e.id} className="border-b border-slate-100 py-1">
                    <span className="font-medium">{e.severity}</span> — {e.description}
                  </li>
                ))}
                {view.openExceptions.length === 0 && <li className="text-slate-400">No open exceptions</li>}
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent movements</h2>
              <ul className="space-y-1 text-sm">
                {view.recentMovements.map((m) => (
                  <li key={m.id} className="flex justify-between border-b border-slate-100 py-1">
                    <span className="font-mono text-xs">{m.referenceCode}</span>
                    <span>{m.movementType} · {m.status}</span>
                  </li>
                ))}
                {view.recentMovements.length === 0 && <li className="text-slate-400">No movements yet</li>}
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Support notes</h2>
              <ul className="mb-3 space-y-1 text-sm">
                {view.notes.map((n) => (
                  <li key={n.id} className="border-b border-slate-100 py-1">
                    <span className="text-slate-500">{n.authorName}:</span> {n.note}
                  </li>
                ))}
                {view.notes.length === 0 && <li className="text-slate-400">No notes yet</li>}
              </ul>
              <form onSubmit={addNote} className="flex gap-2">
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note" className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">Add</button>
              </form>
            </section>

            {!elevated && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">Elevated access</h2>
                <p className="mb-2 text-xs text-slate-500">Explicit, separately-audited step — only for authorised changes on the customer&apos;s behalf.</p>
                <div className="flex gap-2">
                  <input value={elevateReason} onChange={(e) => setElevateReason(e.target.value)} placeholder="Elevation reason (required)" className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                  <button onClick={elevate} disabled={busy || !elevateReason.trim()} className="rounded-md border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50">
                    Request elevation
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
