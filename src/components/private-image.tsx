"use client";

import { useEffect, useState } from "react";

export function PrivateImage({ mediaAssetId, alt, className = "h-full w-full object-cover", fallback }: { mediaAssetId: string | null | undefined; alt: string; className?: string; fallback?: string }) {
  const [resolvedImage, setResolvedImage] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (!mediaAssetId) return;
    fetch(`/api/media/${mediaAssetId}`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data?.url) setResolvedImage({ id: mediaAssetId, url: data.url }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [mediaAssetId]);
  if (!mediaAssetId || resolvedImage?.id !== mediaAssetId) return <span role="img" aria-label={alt} className="flex h-full w-full items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">{fallback ?? "No image"}</span>;
  // This is a short-lived, authenticated application URL rather than a
  // static/remote image host, so a native img is intentionally used here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolvedImage.url} alt={alt} className={className} />;
}
