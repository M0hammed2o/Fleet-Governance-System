"use client";

import { useEffect, useState, useCallback } from "react";

const DOCUMENT_TYPES = ["DRIVER_LICENCE", "PDP", "VEHICLE_LICENCE", "ROADWORTHY_CERTIFICATE", "INSURANCE", "OTHER"] as const;
const ACTIONS = ["WARN", "REQUIRE_SUPERVISOR_APPROVAL", "BLOCK_CLEARANCE"] as const;

interface Rule {
  documentType: (typeof DOCUMENT_TYPES)[number];
  action: (typeof ACTIONS)[number];
}

export default function DocumentRulesPage() {
  const [rules, setRules] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/document-expiry-rules");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load rules");
      const map: Record<string, string> = {};
      for (const rule of data.rules as Rule[]) map[rule.documentType] = rule.action;
      setRules(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function updateRule(documentType: string, action: string) {
    setSaving(documentType);
    setError(null);
    try {
      const res = await fetch("/api/admin/document-expiry-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update rule");
        return;
      }
      setRules((prev) => ({ ...prev, [documentType]: action }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Document expiry rules</h1>
          <p className="text-sm text-slate-500">
            What happens when a document of this type is expired. An expired document never denies a
            movement by itself unless you set it to &quot;Block clearance&quot; here — see build brief.
          </p>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Document type</th>
                  <th className="pb-2">Action when expired</th>
                </tr>
              </thead>
              <tbody>
                {DOCUMENT_TYPES.map((type) => (
                  <tr key={type} className="border-b border-slate-100">
                    <td className="py-2">{type.replace(/_/g, " ")}</td>
                    <td className="py-2">
                      <select
                        value={rules[type] ?? "WARN"}
                        disabled={saving === type}
                        onChange={(e) => updateRule(type, e.target.value)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                      >
                        {ACTIONS.map((a) => (
                          <option key={a} value={a}>
                            {a.replace(/_/g, " ").toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
