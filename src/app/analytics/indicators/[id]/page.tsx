"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Indicator = {
  id: string;
  title: string;
  explanation: string;
  recommendedAction: string;
  subjectType: string;
  subjectLabel: string;
  severity: string;
  status: string;
  occurrenceCount: number;
  evaluationStart: string;
  evaluationEnd: string;
  dataQuality: string;
  ruleSnapshot: Record<string, unknown>;
  rule: { code: string; label: string; version: number; description: string };
  supportingRecords: Array<{ type: string; id: string; occurredAt: string; summary: string }>;
  withheldSupportingRecordCount: number;
  linkedInvestigationCase: { id: string; caseNumber: string } | null;
  events: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string | null; note: string | null; occurredAt: string; actor: { name: string } }>;
};

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

function label(value: string) { return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/(^|\s)\S/g, (part) => part.toUpperCase()); }

export default function AnalyticsIndicatorPage() {
  const { id } = useParams<{ id: string }>();
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [escalationNote, setEscalationNote] = useState("");
  const [existingCaseId, setExistingCaseId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try { setIndicator((await requestJson(`/api/analytics/indicators/${id}`)).indicator); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load indicator."); }
  }, [id]);
  useEffect(() => { queueMicrotask(load); }, [load]);

  async function action(name: "review" | "dismiss" | "reopen") {
    if (!reviewNote.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson(`/api/analytics/indicators/${id}/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: reviewNote }) });
      setReviewNote(""); setMessage(`Indicator ${name === "review" ? "marked as reviewed" : name === "dismiss" ? "dismissed as an explained or accepted variance" : "reopened"}.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review action failed."); }
    finally { setBusy(false); }
  }

  async function escalate() {
    if (!escalationNote.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestJson(`/api/analytics/indicators/${id}/escalate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: escalationNote, existingInvestigationCaseId: existingCaseId || undefined }) });
      setMessage(`Indicator escalated and linked to ${result.investigationCase.caseNumber}.`); setEscalationNote(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Escalation failed."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/analytics" className="text-sm font-medium text-cyan-800 hover:underline">← Executive analytics</Link>
      {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
      {message && <div role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</div>}
      {!indicator && !error && <div role="status" className="rounded border border-slate-200 bg-white p-8 text-center text-slate-500">Loading indicator explanation…</div>}
      {indicator && <>
        <header className="rounded-xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Risk indicator · {indicator.rule.code} v{indicator.rule.version}</p>
          <h1 className="mt-2 text-2xl font-semibold">{indicator.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-white/10 px-3 py-1">{indicator.severity}</span><span className="rounded-full bg-white/10 px-3 py-1">{label(indicator.status)}</span><span className="rounded-full bg-white/10 px-3 py-1">Data: {label(indicator.dataQuality)}</span></div>
        </header>

        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><h2 className="font-semibold">Authorised human review required</h2><p>This indicator is not an accusation, finding, or automated decision. Review the underlying records and relevant operating context before taking any action.</p></section>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2"><h2 className="font-semibold">Why this triggered</h2><p className="mt-2 text-sm leading-6 text-slate-700">{indicator.explanation}</p><h3 className="mt-4 text-sm font-semibold">Recommended action</h3><p className="mt-1 text-sm text-slate-700">{indicator.recommendedAction}</p></section>
          <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Evaluation</h2><dl className="mt-3 space-y-2 text-sm"><div><dt className="text-slate-500">Subject</dt><dd>{label(indicator.subjectType)} · {indicator.subjectLabel}</dd></div><div><dt className="text-slate-500">Occurrences</dt><dd>{indicator.occurrenceCount}</dd></div><div><dt className="text-slate-500">Period</dt><dd>{new Date(indicator.evaluationStart).toLocaleDateString()}–{new Date(indicator.evaluationEnd).toLocaleDateString()}</dd></div></dl></section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Rule threshold snapshot</h2><p className="mt-1 text-xs text-slate-500">This immutable snapshot remains attached even if the tenant later changes the current rule.</p><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">{Object.entries(indicator.ruleSnapshot).map(([key, value]) => <div key={key}><dt className="text-xs text-slate-500">{label(key)}</dt><dd>{value == null ? "Not set" : String(value)}</dd></div>)}</dl></section>

        <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Supporting records</h2><ul className="mt-3 space-y-2">{indicator.supportingRecords.map((record) => <li key={`${record.type}:${record.id}`} className="rounded border border-slate-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{label(record.type)}</strong><span className="text-xs text-slate-500">{new Date(record.occurredAt).toLocaleString()}</span></div><p className="mt-1 text-slate-700">{record.summary}</p><p className="mt-1 font-mono text-xs text-slate-400">{record.id}</p></li>)}{indicator.supportingRecords.length === 0 && <li className="text-sm text-slate-500">No supporting records are available under your permissions.</li>}</ul>{indicator.withheldSupportingRecordCount > 0 && <p className="mt-3 text-xs text-amber-800">{indicator.withheldSupportingRecordCount} supporting record(s) were withheld because your role lacks the underlying resource permission.</p>}</section>

        <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Review workflow</h2><label className="mt-3 block text-sm font-medium">Review note<textarea aria-label="Review note" className="mt-1 min-h-24 w-full rounded border border-slate-300 p-2" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Record the context and basis for the review decision." /></label><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !reviewNote.trim() || indicator.status !== "OPEN"} onClick={() => void action("review")} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Mark reviewed</button><button disabled={busy || !reviewNote.trim() || !["OPEN", "REVIEWED"].includes(indicator.status)} onClick={() => void action("dismiss")} className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">Dismiss as explained variance</button><button disabled={busy || !reviewNote.trim() || !["DISMISSED", "REVIEWED", "ESCALATED"].includes(indicator.status)} onClick={() => void action("reopen")} className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">Reopen indicator</button></div></section>

        <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Escalation to investigation</h2>{indicator.linkedInvestigationCase ? <p className="mt-2 text-sm">Linked to <Link className="font-medium text-cyan-800 hover:underline" href={`/investigations/${indicator.linkedInvestigationCase.id}`}>{indicator.linkedInvestigationCase.caseNumber}</Link>. The indicator remains preserved.</p> : <><label className="mt-3 block text-sm font-medium">Escalation note<textarea aria-label="Escalation note" className="mt-1 min-h-20 w-full rounded border border-slate-300 p-2" value={escalationNote} onChange={(event) => setEscalationNote(event.target.value)} /></label><label className="mt-3 block text-sm font-medium">Existing investigation case ID (optional)<input aria-label="Existing investigation case ID" className="mt-1 w-full rounded border border-slate-300 p-2" value={existingCaseId} onChange={(event) => setExistingCaseId(event.target.value)} /></label><button disabled={busy || !escalationNote.trim() || indicator.status === "DISMISSED"} onClick={() => void escalate()} className="mt-3 rounded bg-cyan-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Escalate for investigation</button></>}</section>

        <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Review chronology</h2><ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">{indicator.events.map((event) => <li key={event.id} className="text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{label(event.action)}</strong><time className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString()}</time></div><p className="text-slate-600">{event.fromStatus ? `${label(event.fromStatus)} → ${label(event.toStatus ?? "")}` : label(event.toStatus ?? "")}{event.note ? ` — ${event.note}` : ""} · {event.actor.name}</p></li>)}{indicator.events.length === 0 && <li className="text-sm text-slate-500">No review actions recorded yet.</li>}</ol></section>
      </>}
    </div>
  </main>;
}
