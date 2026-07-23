"use client";

import { useEffect, useState, useCallback } from "react";

const CATEGORIES = ["PASSENGER", "LIGHT_COMMERCIAL", "TRUCK", "TRUCK_DUAL_REAR_WHEEL", "TRAILER", "CUSTOM"] as const;

interface Position {
  id: string;
  code: string;
  label: string;
}

interface Config {
  id: string;
  name: string;
  category: string;
  isSystem: boolean;
  positions: Position[];
}

export default function TyreConfigsPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("CUSTOM");
  const [positions, setPositions] = useState([{ code: "", label: "" }]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tyre-position-configs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load configs");
      setConfigs(data.configs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  function updatePosition(index: number, field: "code" | "label", value: string) {
    setPositions((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/admin/tyre-position-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, positions: positions.filter((p) => p.code && p.label) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create layout");
        return;
      }
      setName("");
      setPositions([{ code: "", label: "" }]);
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Tyre-position layouts</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Create a custom layout</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Layout name"
                required
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              {positions.map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <input
                    value={p.code}
                    onChange={(e) => updatePosition(i, "code", e.target.value)}
                    placeholder="Code (e.g. FL)"
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={p.label}
                    onChange={(e) => updatePosition(i, "label", e.target.value)}
                    placeholder="Label (e.g. Front Left)"
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPositions((prev) => [...prev, { code: "", label: "" }])}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                + Add position
              </button>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create layout"}
            </button>
          </form>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </section>

        <section className="space-y-4">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading &&
            configs.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-slate-900">{c.name}</h3>
                  <span className="text-xs text-slate-400">{c.category.replace(/_/g, " ")}{c.isSystem ? " · system" : ""}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{c.positions.map((p) => p.label).join(", ")}</p>
              </div>
            ))}
        </section>
      </div>
    </main>
  );
}
