"use client";

import { useEffect, useState, useCallback, use } from "react";

interface Movement {
  id: string;
  referenceCode: string;
  movementType: string;
  status: string;
  purpose: string | null;
  destination: string | null;
  customerProjectJobReference: string | null;
  deliveryOrCollectionReference: string | null;
  purchaseOrderReference: string | null;
  approvedCargoSummary: string | null;
  sealOrContainerReference: string | null;
  approvalComments: string | null;
  cancelledReason: string | null;
  senderName: string | null;
  senderContact: string | null;
  recipientName: string | null;
  recipientContact: string | null;
  vehicle: { registrationNumber: string; fleetNumber: string | null };
  driver: { name: string };
  trailerVehicle: { registrationNumber: string } | null;
  site: { name: string };
  requester: { name: string };
  approver: { name: string } | null;
}

interface MovementDocument {
  id: string;
  fileName: string;
  contentType: string;
  capturedAt: string;
}

export default function MovementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [movement, setMovement] = useState<Movement | null>(null);
  const [documents, setDocuments] = useState<MovementDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/movements/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load movement");
      setMovement(data.movement);
      setDocuments(data.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function uploadDocument(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("ownerType", "MOVEMENT_DOCUMENT");
      form.append("ownerId", id);
      // Stable per (movement, file) so re-submitting the same document over a
      // flaky connection never creates a duplicate MediaAsset row (EVID-003).
      form.append("idempotencyKey", `${id}:${file.name}:${file.size}`);

      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Document upload failed");
        return;
      }
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function viewDocument(documentId: string) {
    setError(null);
    const res = await fetch(`/api/media/${documentId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to open document");
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function callAction(action: "submit" | "approve" | "reject" | "cancel", body?: object) {
    setError(null);
    const res = await fetch(`/api/movements/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? `Failed to ${action}`);
      return;
    }
    setComments("");
    await load();
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (!movement) return <main className="p-8 text-sm text-red-700">{error ?? "Movement not found"}</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="font-mono text-lg font-semibold text-slate-900">{movement.referenceCode}</h1>
            <span className="text-sm font-medium text-slate-700">{movement.status}</span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Type</dt>
            <dd>{movement.movementType}</dd>
            <dt className="text-slate-500">Site</dt>
            <dd>{movement.site.name}</dd>
            <dt className="text-slate-500">Vehicle</dt>
            <dd>{movement.vehicle.registrationNumber}</dd>
            <dt className="text-slate-500">Trailer</dt>
            <dd>{movement.trailerVehicle?.registrationNumber ?? "—"}</dd>
            <dt className="text-slate-500">Driver</dt>
            <dd>{movement.driver.name}</dd>
            <dt className="text-slate-500">Destination</dt>
            <dd>{movement.destination ?? "—"}</dd>
            <dt className="text-slate-500">Job / project ref</dt>
            <dd>{movement.customerProjectJobReference ?? "—"}</dd>
            <dt className="text-slate-500">Delivery/collection ref</dt>
            <dd>{movement.deliveryOrCollectionReference ?? "—"}</dd>
            <dt className="text-slate-500">Purchase order ref</dt>
            <dd>{movement.purchaseOrderReference ?? "—"}</dd>
            <dt className="text-slate-500">Cargo summary</dt>
            <dd>{movement.approvedCargoSummary ?? "—"}</dd>
            <dt className="text-slate-500">Seal/container ref</dt>
            <dd>{movement.sealOrContainerReference ?? "—"}</dd>
            <dt className="text-slate-500">Sender</dt>
            <dd>{movement.senderName ?? "—"}{movement.senderContact ? ` (${movement.senderContact})` : ""}</dd>
            <dt className="text-slate-500">Recipient</dt>
            <dd>{movement.recipientName ?? "—"}{movement.recipientContact ? ` (${movement.recipientContact})` : ""}</dd>
            <dt className="text-slate-500">Requested by</dt>
            <dd>{movement.requester.name}</dd>
            <dt className="text-slate-500">Approved by</dt>
            <dd>{movement.approver?.name ?? "—"}</dd>
          </dl>

          {movement.approvalComments && (
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Comments: {movement.approvalComments}
            </p>
          )}
          {movement.cancelledReason && (
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Cancellation reason: {movement.cancelledReason}
            </p>
          )}

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-4 space-y-2">
            {movement.status === "DRAFT" && (
              <div className="flex gap-2">
                <button onClick={() => callAction("submit")} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                  Submit for approval
                </button>
                <button onClick={() => callAction("cancel")} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                  Cancel
                </button>
              </div>
            )}
            {movement.status === "SUBMITTED" && (
              <div className="space-y-2">
                <input
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Comments (required to reject)"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <div className="flex gap-2">
                  <button onClick={() => callAction("approve", { comments })} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
                    Approve
                  </button>
                  <button onClick={() => callAction("reject", { comments })} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                    Reject
                  </button>
                  <button onClick={() => callAction("cancel")} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {movement.status === "APPROVED" && (
              <button onClick={() => callAction("cancel")} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Documents (delivery notes, supporting files)</h2>
          <ul className="mb-3 space-y-1 text-sm">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between border-b border-slate-100 py-1">
                <span className="text-slate-700">{doc.fileName}</span>
                <button onClick={() => viewDocument(doc.id)} className="text-xs text-slate-900 underline">
                  View
                </button>
              </li>
            ))}
            {documents.length === 0 && <li className="text-slate-400">No documents uploaded yet</li>}
          </ul>
          <input
            type="file"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadDocument(file);
              e.target.value = "";
            }}
            className="text-sm"
          />
          {uploading && <p className="mt-1 text-xs text-slate-500">Uploading…</p>}
        </div>
      </div>
    </main>
  );
}
