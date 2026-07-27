"use client";

import { useEffect, useState, useCallback, use } from "react";
import { ComplianceDocumentsPanel, type ComplianceDocument } from "@/components/compliance-documents-panel";
import { DriverFacialEnrolmentCapture } from "@/components/driver-facial-enrolment";

interface Driver {
  id: string;
  name: string;
  employeeNumber: string | null;
  status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED";
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  pdpNumber: string | null;
  pdpExpiry: string | null;
  restrictions: string | null;
}

interface ManualFallback {
  id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  requestedAt: string;
  resolvedAt: string | null;
}

export default function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [documents, setDocuments] = useState<ComplianceDocument[]>([]);
  const [fallbacks, setFallbacks] = useState<ManualFallback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState("");
  const [enrolmentStatus, setEnrolmentStatus] = useState<{ enrolled: boolean; templateVersion: string | null; enrolledAt: string | null } | null>(null);
  const [enrolmentHistory, setEnrolmentHistory] = useState<Array<{ id: string; status: string; enrolledAt: string; revokedAt: string | null; revokedReason: string | null }>>([]);
  const [showEnrolmentCapture, setShowEnrolmentCapture] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/drivers/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load driver");
      setDriver(data.driver);
      setDocuments(data.documents);
      setFallbacks(data.manualFallbacks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const loadEnrolment = useCallback(async () => {
    // A restricted permission (facialTemplate:VIEW) — a caller without it
    // simply doesn't see this section, not a page-load failure.
    const res = await fetch(`/api/drivers/${id}/facial-enrolment`);
    if (!res.ok) return;
    const data = await res.json();
    setEnrolmentStatus(data.status);
    setEnrolmentHistory(data.history);
  }, [id]);

  useEffect(() => {
    queueMicrotask(loadEnrolment);
  }, [loadEnrolment]);

  async function revokeEnrolment() {
    if (!revokeReason.trim()) return;
    const res = await fetch(`/api/drivers/${id}/facial-enrolment`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: revokeReason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not revoke enrolment");
      return;
    }
    setRevokeReason("");
    await loadEnrolment();
  }

  async function setStatus(status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED") {
    setError(null);
    const res = await fetch(`/api/drivers/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to update status");
      return;
    }
    await load();
  }

  async function runMockVerification(force?: string) {
    setError(null);
    setVerifyResult(null);
    const res = await fetch(`/api/drivers/${id}/facial-verification/mock-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capturedImageRef: force ? `dev-capture-${force}` : "dev-capture-normal" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Verification failed");
      return;
    }
    setVerifyResult(`${data.outcome.result}${data.outcome.failureReason ? ` — ${data.outcome.failureReason}` : ""}`);
  }

  async function requestFallback(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/drivers/${id}/facial-verification/manual-fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: fallbackReason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to request fallback");
      return;
    }
    setFallbackReason("");
    await load();
  }

  async function resolveFallback(fallbackId: string, decision: "APPROVED" | "DENIED") {
    setError(null);
    const res = await fetch(`/api/facial-verification/manual-fallback/${fallbackId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to resolve fallback");
      return;
    }
    await load();
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (!driver) return <main className="p-8 text-sm text-red-700">{error ?? "Driver not found"}</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">{driver.name}</h1>
              <p className="text-sm text-slate-500">{driver.employeeNumber ?? "No employee number"}</p>
            </div>
            <span
              className={
                driver.status === "ACTIVE"
                  ? "text-emerald-700"
                  : driver.status === "SUSPENDED"
                    ? "text-amber-700"
                    : "text-red-700"
              }
            >
              {driver.status}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Licence</dt>
            <dd>{driver.licenceNumber ?? "—"} {driver.licenceClass ?? ""}</dd>
            <dt className="text-slate-500">Licence expiry</dt>
            <dd>{driver.licenceExpiry ? new Date(driver.licenceExpiry).toLocaleDateString() : "—"}</dd>
            <dt className="text-slate-500">PDP</dt>
            <dd>{driver.pdpNumber ?? "—"}</dd>
            <dt className="text-slate-500">Restrictions</dt>
            <dd>{driver.restrictions ?? "None"}</dd>
          </dl>

          <div className="mt-4 flex gap-2">
            {driver.status !== "ACTIVE" && (
              <button onClick={() => setStatus("ACTIVE")} className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
                Reactivate
              </button>
            )}
            {driver.status !== "SUSPENDED" && (
              <button onClick={() => setStatus("SUSPENDED")} className="rounded-md border border-amber-200 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50">
                Suspend
              </button>
            )}
            {driver.status !== "BLACKLISTED" && (
              <button onClick={() => setStatus("BLACKLISTED")} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                Blacklist
              </button>
            )}
          </div>

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <ComplianceDocumentsPanel ownerType="DRIVER" ownerId={driver.id} documents={documents} onChanged={load} />

        {enrolmentStatus && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Biometric enrolment</h2>
            <p className="mb-3 text-sm text-slate-700">
              Status: <span className={enrolmentStatus.enrolled ? "font-medium text-emerald-700" : "text-slate-500"}>{enrolmentStatus.enrolled ? "Enrolled" : "Not enrolled"}</span>
              {enrolmentStatus.enrolledAt && ` · enrolled ${new Date(enrolmentStatus.enrolledAt).toLocaleString()}`}
            </p>

            {!showEnrolmentCapture && (
              <button onClick={() => setShowEnrolmentCapture(true)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                {enrolmentStatus.enrolled ? "Re-enrol" : "Enrol driver"}
              </button>
            )}
            {showEnrolmentCapture && (
              <DriverFacialEnrolmentCapture
                driverId={driver.id}
                onEnrolled={() => {
                  setShowEnrolmentCapture(false);
                  loadEnrolment();
                }}
              />
            )}

            {enrolmentStatus.enrolled && (
              <div className="mt-4 flex gap-2">
                <input
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="Reason for revocation"
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button onClick={revokeEnrolment} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                  Revoke
                </button>
              </div>
            )}

            {enrolmentHistory.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs text-slate-600">
                {enrolmentHistory.map((h) => (
                  <li key={h.id} className="border-b border-slate-100 pb-1">
                    {h.status} — enrolled {new Date(h.enrolledAt).toLocaleString()}
                    {h.revokedAt && ` · revoked ${new Date(h.revokedAt).toLocaleString()}${h.revokedReason ? ` (${h.revokedReason})` : ""}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Facial verification (mock provider — dev only)</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => runMockVerification()} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
              Verify (should pass)
            </button>
            <button onClick={() => runMockVerification("not_verified")} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
              Force not verified
            </button>
            <button onClick={() => runMockVerification("liveness_failed")} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
              Force liveness failed
            </button>
            <button onClick={() => runMockVerification("unavailable")} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
              Force provider unavailable
            </button>
          </div>
          {verifyResult && <p className="mt-3 text-sm text-slate-700">Result: {verifyResult}</p>}

          <form onSubmit={requestFallback} className="mt-4 flex gap-2">
            <input
              value={fallbackReason}
              onChange={(e) => setFallbackReason(e.target.value)}
              placeholder="Reason for manual fallback"
              required
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Request manual fallback
            </button>
          </form>

          {fallbacks.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {fallbacks.map((f) => (
                <li key={f.id} className="rounded-md border border-slate-100 p-2">
                  <div className="flex items-center justify-between">
                    <span>{f.reason}</span>
                    <span
                      className={
                        f.status === "APPROVED" ? "text-emerald-700" : f.status === "DENIED" ? "text-red-700" : "text-amber-700"
                      }
                    >
                      {f.status}
                    </span>
                  </div>
                  {f.status === "PENDING" && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => resolveFallback(f.id, "APPROVED")} className="rounded-md border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">
                        Approve
                      </button>
                      <button onClick={() => resolveFallback(f.id, "DENIED")} className="rounded-md border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50">
                        Deny
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
