"use client";

import { useEffect, useState, useCallback } from "react";
import { ComplianceDocumentsPanel, type ComplianceDocument } from "@/components/compliance-documents-panel";
import { DriverFacialEnrolmentCapture } from "@/components/driver-facial-enrolment";
import { PrivateProfileUpload } from "@/components/private-profile-upload";
import Link from "next/link";

interface Driver {
  id: string;
  name: string;
  employeeNumber: string | null;
  status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED";
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceIssueDate: string | null;
  licenceExpiry: string | null;
  pdpNumber: string | null;
  pdpStatus: string;
  pdpExpiry: string | null;
  restrictions: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  department: string | null;
  notes: string | null;
  portraitMediaAssetId: string | null;
}

interface Rating { score: number; status: "GOOD_STANDING" | "REVIEW_REQUIRED" | "SERIOUS_ATTENTION"; label: string; ruleVersion: string; calculatedAt: string; disclaimer: string; factors: Array<{ code: string; label: string; impact: number; kind: string; action: string | null }> }
interface Assignment { id: string; status: string; effectiveFrom: string; effectiveTo: string | null; reason: string; vehicle: { id: string; registrationNumber: string; fleetNumber: string | null; category: string }; assignedBy: { name: string } }

interface ManualFallback {
  id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  requestedAt: string;
  resolvedAt: string | null;
}

interface BiometricDeletionRequest {
  id: string;
  reason: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "IN_RECOVERY" | "COMPLETED" | "CANCELLED";
  initiatedAt: string;
  recoveryExpiresAt: string | null;
  completedAt: string | null;
}

export function DriverDetailClient({ id }: { id: string }) {
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
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionRequests, setDeletionRequests] = useState<BiometricDeletionRequest[]>([]);
  const [rating, setRating] = useState<Rating | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [gateActivity, setGateActivity] = useState<Array<{ id: string; status: string; direction: string; decision: string | null; createdAt: string; vehicle: { id: string; registrationNumber: string }; gate: { name: string }; exceptions: Array<{ id: string; severity: string; description: string; resolvedAt: string | null }> }>>([]);
  const [auditHistory, setAuditHistory] = useState<Array<{ id: string; timestamp: string; action: string; reason: string | null; user: { name: string } | null }>>([]);

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
      setRating(data.rating);
      setAssignments(data.assignments ?? []);
      setGateActivity(data.gateActivity ?? []);
      setAuditHistory(data.auditHistory ?? []);
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
    const deletionRes = await fetch(`/api/drivers/${id}/facial-enrolment/deletion`);
    if (deletionRes.ok) {
      const deletionData = await deletionRes.json();
      setDeletionRequests(deletionData.requests);
    }
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

  async function requestTemplateDeletion(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch(`/api/drivers/${id}/facial-enrolment/deletion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: deletionReason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not request biometric deletion");
      return;
    }
    setDeletionReason("");
    await loadEnrolment();
  }

  async function decideTemplateDeletion(requestId: string, action: "APPROVE" | "COMPLETE") {
    setError(null);
    const res = await fetch(`/api/drivers/${id}/facial-enrolment/deletion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not update biometric deletion");
      return;
    }
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

  async function updateProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/drivers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      name: form.get("name"), employeeNumber: form.get("employeeNumber") || undefined, contactPhone: form.get("contactPhone") || undefined, contactEmail: form.get("contactEmail") || "", department: form.get("department") || undefined,
      licenceNumber: form.get("licenceNumber") || undefined, licenceClass: form.get("licenceClass") || undefined, licenceIssueDate: form.get("licenceIssueDate") || undefined, licenceExpiry: form.get("licenceExpiry") || undefined,
      pdpStatus: form.get("pdpStatus"), pdpNumber: form.get("pdpNumber") || undefined, pdpExpiry: form.get("pdpExpiry") || undefined, restrictions: form.get("restrictions") || undefined, notes: form.get("notes") || undefined,
    }) });
    const result = await response.json();
    if (!response.ok) setError(result.error ?? "Driver details could not be saved"); else await load();
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
      <div className="mx-auto max-w-5xl space-y-6">
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
            <dt className="text-slate-500">Licence issue</dt>
            <dd>{driver.licenceIssueDate ? new Date(driver.licenceIssueDate).toLocaleDateString() : "—"}</dd>
            <dt className="text-slate-500">PDP</dt>
            <dd>{driver.pdpNumber ?? "—"}</dd>
            <dt className="text-slate-500">Permit status</dt>
            <dd>{driver.pdpStatus.replaceAll("_", " ")}</dd>
            <dt className="text-slate-500">Contact</dt>
            <dd>{driver.contactPhone ?? driver.contactEmail ?? "—"}</dd>
            <dt className="text-slate-500">Department</dt>
            <dd>{driver.department ?? "—"}</dd>
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

          {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <details className="mt-5 rounded-xl bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Edit private driver and licence details</summary><form onSubmit={updateProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">Name and surname<input name="name" required defaultValue={driver.name} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Employee number<input name="employeeNumber" defaultValue={driver.employeeNumber ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Contact phone<input name="contactPhone" defaultValue={driver.contactPhone ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Contact email<input name="contactEmail" type="email" defaultValue={driver.contactEmail ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Department<input name="department" defaultValue={driver.department ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Licence number<input name="licenceNumber" defaultValue={driver.licenceNumber ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Licence class<input name="licenceClass" defaultValue={driver.licenceClass ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Licence issue date<input name="licenceIssueDate" type="date" defaultValue={driver.licenceIssueDate?.slice(0,10) ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Licence expiry<input name="licenceExpiry" type="date" defaultValue={driver.licenceExpiry?.slice(0,10) ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Permit status<select name="pdpStatus" defaultValue={driver.pdpStatus} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>NOT_REQUIRED</option><option>VALID</option><option>PENDING</option><option>EXPIRED</option><option>SUSPENDED</option></select></label><label className="text-xs font-medium">Permit number<input name="pdpNumber" defaultValue={driver.pdpNumber ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Permit expiry<input name="pdpExpiry" type="date" defaultValue={driver.pdpExpiry?.slice(0,10) ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium sm:col-span-2">Restrictions<textarea name="restrictions" defaultValue={driver.restrictions ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>{driver.notes !== null && <label className="text-xs font-medium sm:col-span-2">Authorised internal notes<textarea name="notes" defaultValue={driver.notes ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>}<button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Save driver details</button>
          </form></details>
        </div>

        <div className="grid gap-6 lg:grid-cols-2"><PrivateProfileUpload ownerType="DRIVER_PORTRAIT" ownerId={driver.id} currentMediaAssetId={driver.portraitMediaAssetId} linkEndpoint={`/api/drivers/${driver.id}`} linkField="portraitMediaAssetId" label={`Driver profile image for ${driver.name}`} onChanged={load} />{rating && <section className={`rounded-2xl border p-5 shadow-sm ${rating.status === "GOOD_STANDING" ? "border-emerald-200 bg-emerald-50" : rating.status === "REVIEW_REQUIRED" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}><h2 className="text-sm font-semibold">Operational governance rating</h2><p className="mt-2 text-2xl font-semibold">{rating.status === "GOOD_STANDING" ? "✓" : rating.status === "REVIEW_REQUIRED" ? "!" : "×"} {rating.label} · {rating.score}/100</p><p className="mt-2 text-xs text-slate-600">{rating.disclaimer}</p><ul className="mt-3 space-y-2 text-sm">{rating.factors.map((factor) => <li key={factor.code}><strong>{factor.impact < 0 ? `${factor.impact}: ` : "✓ "}</strong>{factor.label}{factor.action && <span className="block text-xs text-slate-600">Action: {factor.action}</span>}</li>)}</ul><p className="mt-3 text-xs text-slate-500">Rule {rating.ruleVersion} · calculated {new Date(rating.calculatedAt).toLocaleString()}</p></section>}</div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Vehicle assignment history</h2><Link href="/admin/assignments" className="text-xs font-medium text-cyan-800">Manage assignments</Link></div><ul className="mt-3 space-y-2 text-sm">{assignments.map((assignment) => <li key={assignment.id} className="rounded-xl bg-slate-50 p-3"><Link href={`/admin/vehicles/${assignment.vehicle.id}`} className="font-medium hover:underline">{assignment.vehicle.registrationNumber}</Link> · {assignment.vehicle.category.replaceAll("_", " ")} · <strong>{assignment.status}</strong><span className="block text-xs text-slate-500">{new Date(assignment.effectiveFrom).toLocaleString()} — {assignment.effectiveTo ? new Date(assignment.effectiveTo).toLocaleString() : "current"} · {assignment.assignedBy.name} · {assignment.reason}</span></li>)}{assignments.length === 0 && <li className="text-slate-500">No assignment history.</li>}</ul></section>

        <ComplianceDocumentsPanel ownerType="DRIVER" ownerId={driver.id} documents={documents} onChanged={load} />

        <section className="grid gap-6 lg:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold">Recent gate activity and exceptions</h2><ul className="mt-3 space-y-2 text-sm">{gateActivity.map((event) => <li key={event.id} className="border-b border-slate-100 pb-2"><Link href={`/gate/events/${event.id}`} className="font-medium hover:underline">{event.direction} · {event.vehicle.registrationNumber}</Link><span className="block text-xs text-slate-500">{event.gate.name} · {event.status} · {new Date(event.createdAt).toLocaleString()}</span>{event.exceptions.map((exception) => <span key={exception.id} className="block text-xs text-red-700">{exception.severity}: {exception.description} · {exception.resolvedAt ? "resolved" : "open"}</span>)}</li>)}{gateActivity.length === 0 && <li className="text-slate-500">No gate activity.</li>}</ul></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold">Audit chronology</h2><ul className="mt-3 space-y-2 text-sm">{auditHistory.map((entry) => <li key={entry.id} className="border-b border-slate-100 pb-2"><strong>{entry.action}</strong><span className="block text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()} · {entry.user?.name ?? "System"}{entry.reason ? ` · ${entry.reason}` : ""}</span></li>)}{auditHistory.length === 0 && <li className="text-slate-500">No matching audit events.</li>}</ul></div></section>

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

            {enrolmentHistory.some((entry) => entry.status !== "DELETED") && !deletionRequests.some((entry) => ["PENDING_APPROVAL", "APPROVED", "IN_RECOVERY"].includes(entry.status)) && (
              <form onSubmit={requestTemplateDeletion} className="mt-5 space-y-2 border-t border-slate-200 pt-4">
                <label htmlFor="biometric-deletion-reason" className="block text-sm font-medium text-slate-800">Request biometric material deletion</label>
                <p className="text-xs text-slate-600">A different authorized user must approve. Material is erased only after the 30-day recovery window; safe chronology remains.</p>
                <div className="flex flex-wrap gap-2">
                  <input id="biometric-deletion-reason" required minLength={10} value={deletionReason} onChange={(event) => setDeletionReason(event.target.value)} placeholder="Required deletion reason" className="min-h-11 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <button type="submit" className="min-h-11 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-800">Request deletion</button>
                </div>
              </form>
            )}

            {deletionRequests.length > 0 && (
              <div className="mt-4 space-y-2" aria-label="Biometric deletion requests">
                {deletionRequests.map((request) => (
                  <div key={request.id} className="rounded-md border border-slate-200 p-3 text-xs text-slate-700">
                    <p><span className="font-semibold">{request.status}</span> — {request.reason}</p>
                    <p>Requested {new Date(request.initiatedAt).toLocaleString()}{request.recoveryExpiresAt ? ` · deletion eligible after ${new Date(request.recoveryExpiresAt).toLocaleString()}` : ""}</p>
                    {request.status === "PENDING_APPROVAL" && <button type="button" onClick={() => decideTemplateDeletion(request.id, "APPROVE")} className="mt-2 min-h-11 rounded-md border border-amber-300 px-3 py-2 font-medium text-amber-900">Approve as independent reviewer</button>}
                    {request.status === "APPROVED" && <button type="button" onClick={() => decideTemplateDeletion(request.id, "COMPLETE")} className="mt-2 min-h-11 rounded-md border border-red-300 px-3 py-2 font-medium text-red-800">Complete after recovery window</button>}
                    {request.completedAt && <p>Material deleted {new Date(request.completedAt).toLocaleString()}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Synthetic facial-verification scenarios</h2>
          <p className="mb-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900" role="note">
            SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION
          </p>
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
