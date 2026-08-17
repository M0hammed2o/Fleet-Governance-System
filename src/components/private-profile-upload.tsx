"use client";

import { useState } from "react";
import { PrivateImage } from "@/components/private-image";

export function PrivateProfileUpload({ ownerType, ownerId, currentMediaAssetId, linkEndpoint, linkField, label, onChanged }: {
  ownerType: "DRIVER_PORTRAIT" | "VEHICLE_IMAGE" | "STAFF_PROFILE";
  ownerId: string;
  currentMediaAssetId?: string | null;
  linkEndpoint: string;
  linkField: "portraitMediaAssetId" | "imageMediaAssetId" | "profileMediaAssetId";
  label: string;
  onChanged: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("ownerType", ownerType);
      form.set("ownerId", ownerId);
      form.set("idempotencyKey", crypto.randomUUID());
      form.set("category", ownerType === "DRIVER_PORTRAIT" || ownerType === "STAFF_PROFILE" ? "DRIVER_PORTRAIT" : "VEHICLE_INSPECTION_PHOTO");
      const response = await fetch("/api/media/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Upload failed");
      const linked = await fetch(linkEndpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [linkField]: result.mediaAsset.id }) });
      const linkedResult = await linked.json();
      if (!linked.ok) throw new Error(linkedResult.error ?? "The image could not be linked");
      if (currentMediaAssetId && currentMediaAssetId !== result.mediaAsset.id) {
        await fetch(`/api/media/${currentMediaAssetId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: `${label} replaced with a newer authorised image` }) });
      }
      setFile(null);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!currentMediaAssetId) return;
    setBusy(true);
    const response = await fetch(`/api/media/${currentMediaAssetId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: `${label} removed from the master-data profile` }) });
    const result = await response.json();
    if (!response.ok) setError(result.error ?? "Image could not be deleted");
    else await onChanged();
    setBusy(false);
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby={`${ownerType}-${ownerId}-heading`}>
    <h2 id={`${ownerType}-${ownerId}-heading`} className="text-sm font-semibold text-slate-950">{label}</h2>
    <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center"><div className="size-28 overflow-hidden rounded-2xl border border-slate-200"><PrivateImage mediaAssetId={currentMediaAssetId} alt={label} fallback="No image" /></div><div className="flex-1"><label className="block text-xs font-medium text-slate-700">Choose a private image<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-medium" /></label><p className="mt-2 text-xs text-slate-500">JPEG, PNG, WebP or HEIC; maximum 25 MB. Images are converted to WebP and metadata is stripped.</p><div className="mt-3 flex gap-2"><button type="button" disabled={!file || busy} onClick={upload} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Working…" : currentMediaAssetId ? "Replace image" : "Upload image"}</button>{currentMediaAssetId && <button type="button" disabled={busy} onClick={remove} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Delete image</button>}</div></div></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-800">{error}</p>}
  </section>;
}
