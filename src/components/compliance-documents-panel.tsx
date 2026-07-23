"use client";

import { useState } from "react";

export interface ComplianceDocument {
  id: string;
  documentType: string;
  documentNumber: string | null;
  expiryDate: string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  // Computed server-side (lib/documents/expiry-rules.ts) — avoids comparing
  // against the client's clock and avoids calling Date.now() during render.
  isExpired: boolean;
}

const DOCUMENT_TYPES_BY_OWNER: Record<"DRIVER" | "VEHICLE", string[]> = {
  DRIVER: ["DRIVER_LICENCE", "PDP", "OTHER"],
  VEHICLE: ["VEHICLE_LICENCE", "ROADWORTHY_CERTIFICATE", "INSURANCE", "OTHER"],
};

export function ComplianceDocumentsPanel({
  ownerType,
  ownerId,
  documents,
  onChanged,
}: {
  ownerType: "DRIVER" | "VEHICLE";
  ownerId: string;
  documents: ComplianceDocument[];
  onChanged: () => void | Promise<void>;
}) {
  const [documentType, setDocumentType] = useState(DOCUMENT_TYPES_BY_OWNER[ownerType][0]);
  const [documentNumber, setDocumentNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/compliance-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerType,
          [ownerType === "DRIVER" ? "driverId" : "vehicleId"]: ownerId,
          documentType,
          documentNumber: documentNumber || undefined,
          expiryDate: expiryDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add document");
        return;
      }
      setDocumentNumber("");
      setExpiryDate("");
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(documentId: string, decision: "VERIFIED" | "REJECTED") {
    setError(null);
    const res = await fetch(`/api/compliance-documents/${documentId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to record verification");
      return;
    }
    await onChanged();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Compliance documents</h2>

      <form onSubmit={handleAdd} className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-end">
        <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          {DOCUMENT_TYPES_BY_OWNER[ownerType].map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
          placeholder="Document number"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add document"}
        </button>
      </form>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {documents.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {documents.map((doc) => {
            const isExpired = doc.isExpired;
            return (
              <li key={doc.id} className="flex items-center justify-between rounded-md border border-slate-100 p-2">
                <div>
                  <div className="font-medium text-slate-700">
                    {doc.documentType.replace(/_/g, " ")} {doc.documentNumber && `— ${doc.documentNumber}`}
                  </div>
                  <div className={isExpired ? "text-red-600" : "text-slate-500"}>
                    {doc.expiryDate ? `Expires ${new Date(doc.expiryDate).toLocaleDateString()}${isExpired ? " (expired)" : ""}` : "No expiry set"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      doc.verificationStatus === "VERIFIED"
                        ? "text-emerald-700"
                        : doc.verificationStatus === "REJECTED"
                          ? "text-red-700"
                          : "text-slate-400"
                    }
                  >
                    {doc.verificationStatus}
                  </span>
                  {doc.verificationStatus === "UNVERIFIED" && (
                    <>
                      <button onClick={() => verify(doc.id, "VERIFIED")} className="rounded-md border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">
                        Verify
                      </button>
                      <button onClick={() => verify(doc.id, "REJECTED")} className="rounded-md border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50">
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
