"use client";

import { useEffect, useState, useCallback } from "react";

interface GateRow {
  id: string;
  name: string;
  direction: "ENTRY" | "EXIT" | "BOTH";
}

interface SiteRow {
  id: string;
  name: string;
  address: string | null;
  gates: GateRow[];
}

export default function OrganisationPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [creatingSite, setCreatingSite] = useState(false);

  const [gateSiteId, setGateSiteId] = useState("");
  const [gateName, setGateName] = useState("");
  const [gateDirection, setGateDirection] = useState<"ENTRY" | "EXIT" | "BOTH">("BOTH");
  const [creatingGate, setCreatingGate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sites");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load sites");
      setSites(data.sites);
      setGateSiteId((current) => current || data.sites[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleCreateSite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingSite(true);
    try {
      const res = await fetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: siteName, address: siteAddress || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create site");
        return;
      }
      setSiteName("");
      setSiteAddress("");
      await load();
    } finally {
      setCreatingSite(false);
    }
  }

  async function handleCreateGate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingGate(true);
    try {
      const res = await fetch("/api/admin/gates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: gateSiteId, name: gateName, direction: gateDirection }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create gate");
        return;
      }
      setGateName("");
      await load();
    } finally {
      setCreatingGate(false);
    }
  }

  async function archiveSite(siteId: string) {
    setError(null);
    const res = await fetch(`/api/admin/sites/${siteId}/archive`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to archive site");
      return;
    }
    await load();
  }

  async function archiveGate(gateId: string) {
    setError(null);
    const res = await fetch(`/api/admin/gates/${gateId}/archive`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to archive gate");
      return;
    }
    await load();
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Sites &amp; gates</h1>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Add a site</h2>
          <form onSubmit={handleCreateSite} className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="Site name"
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              placeholder="Address (optional)"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={creatingSite}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creatingSite ? "Adding…" : "Add site"}
            </button>
          </form>
        </section>

        {sites.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Add a gate</h2>
            <form onSubmit={handleCreateGate} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
              <select
                value={gateSiteId}
                onChange={(e) => setGateSiteId(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                value={gateName}
                onChange={(e) => setGateName(e.target.value)}
                placeholder="Gate name"
                required
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <select
                value={gateDirection}
                onChange={(e) => setGateDirection(e.target.value as "ENTRY" | "EXIT" | "BOTH")}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="BOTH">Entry &amp; Exit</option>
                <option value="ENTRY">Entry only</option>
                <option value="EXIT">Exit only</option>
              </select>
              <button
                type="submit"
                disabled={creatingGate}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {creatingGate ? "Adding…" : "Add gate"}
              </button>
            </form>
          </section>
        )}

        <section className="space-y-4">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading &&
            sites.map((site) => (
              <div key={site.id} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-slate-900">{site.name}</h3>
                    {site.address && <p className="text-sm text-slate-500">{site.address}</p>}
                  </div>
                  <button
                    onClick={() => archiveSite(site.id)}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Archive site
                  </button>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  {site.gates.map((gate) => (
                    <li key={gate.id} className="flex items-center justify-between">
                      <span>
                        {gate.name} <span className="text-xs text-slate-400">({gate.direction})</span>
                      </span>
                      <button
                        onClick={() => archiveGate(gate.id)}
                        className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Archive
                      </button>
                    </li>
                  ))}
                  {site.gates.length === 0 && <li className="text-slate-400">No gates yet</li>}
                </ul>
              </div>
            ))}
        </section>
      </div>
    </main>
  );
}
