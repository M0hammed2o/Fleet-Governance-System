"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { VideoCaptureRecorder } from "@/components/video-capture-recorder";
import type { CapturedVideoMetadata } from "@/lib/media/video-capture-policy";

interface InspectionItem {
  id: string;
  section: string;
  label: string;
  responseType: "CHECK" | "READING" | "TEXT";
  unit: string | null;
  isRequired: boolean;
}

interface InspectionResult {
  id: string;
  inspectionItemId: string;
  outcome: string;
  readingValue: string | null;
  readingUnit: string | null;
  comment: string | null;
  evidenceMediaAssetId: string | null;
}

interface ExceptionRow {
  id: string;
  description: string;
  severity: string;
  requiresSupervisorApproval: boolean;
  outcomeAction: string | null;
  resolvedAt: string | null;
  raisedBy: { name: string };
}

interface GateEventDetail {
  id: string;
  status: string;
  direction: string;
  decision: string | null;
  decisionReason: string | null;
  identityVerificationResult: string | null;
  vehicle: { registrationNumber: string; fleetNumber: string | null };
  trailerVehicle: { registrationNumber: string } | null;
  driver: { id: string; name: string };
  gate: { name: string };
  site: { name: string };
  movementAuthorisation: { referenceCode: string; approvedCargoSummary: string | null; destination: string | null };
  inspectionTemplate: { items: InspectionItem[] } | null;
  inspectionResults: InspectionResult[];
  exceptions: ExceptionRow[];
}

const SECTION_LABELS: Record<string, string> = {
  DRIVER_AUTHORISATION: "Driver & authorisation",
  VEHICLE_IDENTITY: "Vehicle identity",
  EXTERIOR_CONDITION: "Exterior condition",
  LIGHTS: "Lights",
  TYRES_WHEELS: "Tyres & wheels",
  OPERATIONAL_INFO: "Operational info",
  LOAD_VERIFICATION: "Load verification",
};

const OUTCOME_ACTIONS = [
  "WARNING",
  "MANUAL_REVIEW",
  "SUPERVISOR_APPROVAL",
  "WORKSHOP_LOCKOUT",
  "SECURITY_HOLD",
  "DENIED",
  "CLEARED_WITH_OBSERVATION",
];

export default function GateEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [event, setEvent] = useState<GateEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [capturedImageRef, setCapturedImageRef] = useState("");
  const [manualFallbackId, setManualFallbackId] = useState("");
  const [fallbackReason, setFallbackReason] = useState("");
  const [denyReason, setDenyReason] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [outcomeAction, setOutcomeAction] = useState(OUTCOME_ACTIONS[0]);
  const [itemInputs, setItemInputs] = useState<Record<string, { outcome: string; readingValue: string; comment: string }>>({});
  const [itemFiles, setItemFiles] = useState<Record<string, File | null>>({});
  // Set only when the file for this item came from VideoCaptureRecorder
  // (Phase 8E-006), never for a plain file-picker selection — carries the
  // honestly-reported actual codec/resolution/duration/bitrate/file size so
  // it can be attached as captureMetadata on upload.
  const [itemVideoMetadata, setItemVideoMetadata] = useState<Record<string, CapturedVideoMetadata | null>>({});
  const [itemShowRecorder, setItemShowRecorder] = useState<Record<string, boolean>>({});
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gate/gate-events/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load gate event");
      setEvent(data.gateEvent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function call(path: string, body?: object) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return null;
      }
      await load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (!event) return <main className="p-8 text-sm text-red-700">{error ?? "Gate event not found"}</main>;

  const openException = event.exceptions.find((e) => !e.resolvedAt);
  const resultByItemId = new Map(event.inspectionResults.map((r) => [r.inspectionItemId, r]));

  function itemInput(itemId: string) {
    return itemInputs[itemId] ?? { outcome: "PASS", readingValue: "", comment: "" };
  }

  /**
   * Uploads the selected file (if any) for this inspection item through the
   * secure media-upload endpoint (permission-checked, server-side type/size
   * validated, checksummed) and returns the resulting MediaAsset id to link
   * into the inspection result — not a pasted URL string (Phase 4, see
   * DECISIONS.md D-012).
   */
  async function uploadEvidenceIfSelected(item: InspectionItem): Promise<string | undefined> {
    const file = itemFiles[item.id];
    if (!file) return undefined;

    setUploadingItemId(item.id);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("ownerType", "GATE_EVENT_INSPECTION_ITEM");
      form.append("ownerId", id);
      // Stable per (gate event, item, file) so re-submitting the same
      // evidence over a flaky connection never creates a duplicate
      // MediaAsset row (EVID-003).
      form.append("idempotencyKey", `${id}:${item.id}:${file.name}:${file.size}`);

      const videoMetadata = itemVideoMetadata[item.id];
      if (videoMetadata) {
        form.append("category", "VEHICLE_INSPECTION_VIDEO");
        form.append("captureMetadata", JSON.stringify(videoMetadata));
      }

      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Evidence upload failed");
        return undefined;
      }
      return data.mediaAsset?.id as string | undefined;
    } finally {
      setUploadingItemId(null);
    }
  }

  async function submitInspectionItem(item: InspectionItem) {
    const input = itemInput(item.id);
    const evidenceMediaAssetId = await uploadEvidenceIfSelected(item);
    await call(`/api/gate/gate-events/${id}/inspection-results`, {
      inspectionItemId: item.id,
      outcome: input.outcome,
      readingValue: input.readingValue || undefined,
      readingUnit: item.unit || undefined,
      comment: input.comment || undefined,
      evidenceMediaAssetId,
    });
  }

  const sections = event.inspectionTemplate
    ? Array.from(new Set(event.inspectionTemplate.items.map((i) => i.section)))
    : [];

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/gate" className="text-sm text-slate-500 underline">← Back to lookup</Link>
          <span className="rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white">{event.status.replaceAll("_", " ")}</span>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">{event.vehicle.registrationNumber}</h1>
          <p className="text-sm text-slate-600">
            {event.driver.name} · {event.direction} · {event.gate.name} ({event.site.name})
          </p>
          <p className="mt-1 font-mono text-xs text-slate-400">{event.movementAuthorisation.referenceCode}</p>
          {event.trailerVehicle && <p className="text-sm text-slate-600">Trailer: {event.trailerVehicle.registrationNumber}</p>}
          {event.movementAuthorisation.approvedCargoSummary && (
            <p className="mt-2 text-sm text-slate-600">Cargo: {event.movementAuthorisation.approvedCargoSummary}</p>
          )}
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {event.status === "INSPECTION_STARTED" && (
          <button
            disabled={busy}
            onClick={() => call(`/api/gate/gate-events/${id}/identity/pending`)}
            className="w-full rounded-lg bg-slate-900 px-6 py-4 text-lg font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Proceed to identity check
          </button>
        )}

        {event.status === "IDENTITY_PENDING" && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Driver identity verification</h2>
            <p className="text-xs text-slate-500">Last result: {event.identityVerificationResult ?? "Not yet attempted"}</p>
            <input
              value={capturedImageRef}
              onChange={(e) => setCapturedImageRef(e.target.value)}
              placeholder="Capture reference (leave blank to simulate a normal capture)"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              disabled={busy}
              onClick={() => call(`/api/gate/gate-events/${id}/identity/verify`, { capturedImageRef: capturedImageRef || "capture-ref" })}
              className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Run verification
            </button>

            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-500">If verification fails, request a manual fallback:</p>
              <input
                value={fallbackReason}
                onChange={(e) => setFallbackReason(e.target.value)}
                placeholder="Reason for manual fallback"
                className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                disabled={busy || !fallbackReason}
                onClick={async () => {
                  const res = await call(`/api/drivers/${event.driver.id}/facial-verification/manual-fallback`, { reason: fallbackReason });
                  if (res?.fallback?.id) setManualFallbackId(res.fallback.id);
                }}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Request manual fallback
              </button>
              {manualFallbackId && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-slate-500">
                    Fallback request <span className="font-mono">{manualFallbackId}</span> submitted — once a
                    supervisor approves it, confirm below.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => call(`/api/gate/gate-events/${id}/identity/manual-verified`, { manualFallbackId })}
                    className="w-full rounded-md border border-emerald-300 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50"
                  >
                    Confirm identity via approved manual fallback
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {event.status === "IDENTITY_VERIFIED" && (
          <button
            disabled={busy}
            onClick={() => call(`/api/gate/gate-events/${id}/vehicle-checks/start`)}
            className="w-full rounded-lg bg-slate-900 px-6 py-4 text-lg font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Begin guided vehicle inspection
          </button>
        )}

        {event.status === "VEHICLE_CHECKS_IN_PROGRESS" && event.inspectionTemplate && (
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">{SECTION_LABELS[section] ?? section}</h3>
                <div className="space-y-3">
                  {event.inspectionTemplate!.items.filter((i) => i.section === section).map((item) => {
                    const existing = resultByItemId.get(item.id);
                    const input = itemInput(item.id);
                    return (
                      <div key={item.id} className="border-b border-slate-100 pb-3 last:border-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-800">{item.label}</span>
                          {existing && (
                            <span
                              className={`text-xs font-semibold ${existing.outcome === "PASS" ? "text-emerald-700" : existing.outcome === "FAIL" ? "text-red-700" : "text-slate-500"}`}
                            >
                              {existing.outcome}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={input.outcome}
                            onChange={(e) => setItemInputs((s) => ({ ...s, [item.id]: { ...input, outcome: e.target.value } }))}
                            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                          >
                            <option value="PASS">Pass</option>
                            <option value="FAIL">Fail</option>
                            <option value="NOT_APPLICABLE">Not applicable</option>
                            <option value="UNABLE_TO_VERIFY">Unable to verify</option>
                          </select>
                          {item.responseType === "READING" && (
                            <input
                              value={input.readingValue}
                              onChange={(e) => setItemInputs((s) => ({ ...s, [item.id]: { ...input, readingValue: e.target.value } }))}
                              placeholder={item.unit ?? "value"}
                              className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          )}
                          <input
                            value={input.comment}
                            onChange={(e) => setItemInputs((s) => ({ ...s, [item.id]: { ...input, comment: e.target.value } }))}
                            placeholder="Comment (optional)"
                            className="min-w-[120px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                          />
                          <button
                            disabled={busy || uploadingItemId === item.id}
                            onClick={() => submitInspectionItem(item)}
                            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {uploadingItemId === item.id ? "Uploading…" : "Save"}
                          </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="file"
                            accept="image/*,video/*"
                            onChange={(e) => {
                              setItemFiles((s) => ({ ...s, [item.id]: e.target.files?.[0] ?? null }));
                              setItemVideoMetadata((s) => ({ ...s, [item.id]: null }));
                            }}
                            className="max-w-55 text-xs text-slate-500"
                          />
                          <button
                            type="button"
                            onClick={() => setItemShowRecorder((s) => ({ ...s, [item.id]: !s[item.id] }))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            {itemShowRecorder[item.id] ? "Hide camera" : "Record video"}
                          </button>
                          {itemFiles[item.id] && (
                            <span className="text-xs text-emerald-700">
                              {itemFiles[item.id]!.name} selected — will upload when you Save
                            </span>
                          )}
                          {existing?.evidenceMediaAssetId && (
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await fetch(`/api/media/${existing.evidenceMediaAssetId}`);
                                const data = await res.json();
                                if (res.ok && data.url) window.open(data.url, "_blank", "noopener,noreferrer");
                                else setError(data.error ?? "Could not load evidence");
                              }}
                              className="text-xs font-medium text-slate-600 underline"
                            >
                              View evidence
                            </button>
                          )}
                        </div>
                        {itemShowRecorder[item.id] && (
                          <div className="mt-2">
                            <VideoCaptureRecorder
                              fileName={`inspection-${item.id}`}
                              onCaptured={(file, metadata) => {
                                setItemFiles((s) => ({ ...s, [item.id]: file }));
                                setItemVideoMetadata((s) => ({ ...s, [item.id]: metadata }));
                                setItemShowRecorder((s) => ({ ...s, [item.id]: false }));
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => call(`/api/gate/gate-events/${id}/clear`)}
                className="flex-1 rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Clear vehicle
              </button>
              <button
                disabled={busy || !denyReason}
                onClick={() => call(`/api/gate/gate-events/${id}/deny`, { reason: denyReason })}
                className="flex-1 rounded-lg bg-red-700 px-4 py-3 font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                Deny vehicle
              </button>
            </div>
            <input
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Reason (required to deny)"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        {(event.status === "EXCEPTION_RAISED" || event.status === "SUPERVISOR_REVIEW") && openException && (
          <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-amber-900">Open exception</h2>
            <p className="text-sm text-amber-900">{openException.description}</p>
            <p className="text-xs text-amber-700">
              Severity: {openException.severity} · Raised by {openException.raisedBy.name}
              {openException.requiresSupervisorApproval ? " · Requires supervisor approval" : ""}
            </p>

            {event.status === "EXCEPTION_RAISED" && openException.requiresSupervisorApproval && (
              <button
                disabled={busy}
                onClick={() => call(`/api/gate/gate-events/${id}/escalate`)}
                className="w-full rounded-md border border-amber-400 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Escalate to supervisor
              </button>
            )}

            <div className="border-t border-amber-200 pt-3">
              <p className="mb-2 text-xs font-medium text-amber-800">
                Resolve (requires supervisor / exception approval permission — a gate officer resolving
                their own serious exception will be rejected):
              </p>
              <select
                value={outcomeAction}
                onChange={(e) => setOutcomeAction(e.target.value)}
                className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {OUTCOME_ACTIONS.map((a) => (
                  <option key={a} value={a}>{a.replaceAll("_", " ")}</option>
                ))}
              </select>
              <input
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Resolution notes"
                className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                disabled={busy}
                onClick={() => call(`/api/gate/exceptions/${openException.id}/resolve`, { outcomeAction, resolutionNotes })}
                className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Resolve exception
              </button>
            </div>
          </div>
        )}

        {(event.status === "CLEARED" || event.status === "DENIED") && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <p className={`text-lg font-bold ${event.decision === "CLEARED" ? "text-emerald-700" : "text-red-700"}`}>
              {event.decision}
            </p>
            {event.decisionReason && <p className="text-sm text-slate-600">{event.decisionReason}</p>}
            <button
              disabled={busy}
              onClick={() => call(`/api/gate/gate-events/${id}/complete`)}
              className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Complete gate event
            </button>
          </div>
        )}

        {(event.status === "COMPLETED" || event.status === "CANCELLED") && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-900">Gate event {event.status.toLowerCase()}</p>
            <Link href="/gate" className="mt-3 inline-block text-sm text-slate-500 underline">Back to lookup</Link>
          </div>
        )}

        {!["COMPLETED", "CANCELLED"].includes(event.status) && (
          <button
            disabled={busy}
            onClick={() => call(`/api/gate/gate-events/${id}/cancel`, { reason: "Cancelled by officer" })}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
          >
            Cancel gate event
          </button>
        )}
      </div>
    </main>
  );
}
