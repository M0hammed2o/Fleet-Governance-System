import type { MediaCategory } from "@/generated/prisma/client";

/**
 * Configuration data, not scattered per-route constants (Phase 8B) — every
 * category-specific rule (size limit, allowed content types, whether a
 * flagged/high-resolution original is preserved alongside the compressed
 * copy, which compression profile applies) lives here, in one place, so a
 * future tenant-configurable override has exactly one table to read from
 * instead of grep-ing the codebase for hardcoded numbers.
 */

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB — pre-compression upload limit (D-013)
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB — pre-compression upload limit (D-013)

const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const ALLOWED_VIDEO_CONTENT_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const ALLOWED_DOCUMENT_CONTENT_TYPES = new Set(["application/pdf"]);

export type MediaKind = "image" | "video" | "document";

export function classifyContentType(contentType: string): MediaKind | null {
  const normalized = contentType.toLowerCase();
  if (ALLOWED_IMAGE_CONTENT_TYPES.has(normalized)) return "image";
  if (ALLOWED_VIDEO_CONTENT_TYPES.has(normalized)) return "video";
  if (ALLOWED_DOCUMENT_CONTENT_TYPES.has(normalized)) return "document";
  return null;
}

export function maxBytesForKind(kind: MediaKind): number {
  if (kind === "image") return MAX_IMAGE_BYTES;
  if (kind === "video") return MAX_VIDEO_BYTES;
  return MAX_IMAGE_BYTES; // documents share the image ceiling — no dedicated document limit requested
}

export interface MediaCategoryRule {
  /** Whether this category ever preserves the original, uncompressed file alongside the compressed copy — see ARCHITECTURE.md "Preserve high-resolution originals only for flagged incidents". */
  preserveOriginalByDefault: boolean;
  /** Compression profile name applied to images in this category (lib/storage/image-compression.ts). */
  imageCompressionProfile: "standard" | "high-quality";
  /** Default retention category used by Phase 8C's RetentionPolicy lookup — see ARCHITECTURE.md "Retention architecture". */
  defaultRetentionCategory: MediaCategory;
}

/**
 * One rule per MediaCategory (Phase 8B's ten evidence categories). Every
 * category defaults to "standard" compression; DAMAGE_EVIDENCE and
 * INVESTIGATION_EVIDENCE preserve the original alongside the compressed
 * copy and use the "high-quality" profile (larger target size/higher
 * quality floor — accidents, serious damage and investigations are exactly
 * the cases ARCHITECTURE.md calls out for "higher-quality evidence
 * permitted").
 */
export const MEDIA_CATEGORY_RULES: Record<MediaCategory, MediaCategoryRule> = {
  DRIVER_PORTRAIT: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "DRIVER_PORTRAIT" },
  FACIAL_AUDIT: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "FACIAL_AUDIT" },
  VEHICLE_INSPECTION_PHOTO: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "VEHICLE_INSPECTION_PHOTO" },
  VEHICLE_INSPECTION_VIDEO: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "VEHICLE_INSPECTION_VIDEO" },
  DAMAGE_EVIDENCE: { preserveOriginalByDefault: true, imageCompressionProfile: "high-quality", defaultRetentionCategory: "DAMAGE_EVIDENCE" },
  CARGO_EVIDENCE: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "CARGO_EVIDENCE" },
  DELIVERY_DOCUMENT: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "DELIVERY_DOCUMENT" },
  INVESTIGATION_EVIDENCE: { preserveOriginalByDefault: true, imageCompressionProfile: "high-quality", defaultRetentionCategory: "INVESTIGATION_EVIDENCE" },
  GENERATED_REPORT: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "GENERATED_REPORT" },
  OTHER_DOCUMENT: { preserveOriginalByDefault: false, imageCompressionProfile: "standard", defaultRetentionCategory: "OTHER_DOCUMENT" },
};
