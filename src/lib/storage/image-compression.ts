import "server-only";
import sharp from "sharp";

/**
 * Configurable photo-compression rules (Phase 8B, ARCHITECTURE.md
 * "Photographs"): WebP where supported, max 1,920px on the longest side,
 * configurable quality between 75-82%. Two named profiles — "standard" for
 * everyday evidence, "high-quality" for flagged incidents (accidents,
 * serious damage, investigations) where a lower compression ratio is
 * appropriate. Both are config, not scattered literals — see
 * MEDIA_CATEGORY_RULES (lib/storage/media-categories.ts) for which category
 * uses which profile.
 */
export interface ImageCompressionProfile {
  maxDimensionPx: number;
  quality: number; // 75-82 per ARCHITECTURE.md
  format: "webp";
}

export const IMAGE_COMPRESSION_PROFILES: Record<"standard" | "high-quality", ImageCompressionProfile> = {
  standard: { maxDimensionPx: 1920, quality: 78, format: "webp" },
  "high-quality": { maxDimensionPx: 1920, quality: 82, format: "webp" },
};

export interface CompressedImage {
  data: Buffer;
  contentType: string;
  widthPx: number;
  heightPx: number;
  profile: string;
}

/**
 * Converts an image to WebP, resized so its longest side never exceeds
 * `maxDimensionPx` (never upscaled — `withoutEnlargement`). Only ever
 * called for content types `classifyContentType()` already recognised as
 * "image" (media-asset-repository.ts) — an unrecognised/corrupt image
 * buffer is allowed to throw, and the caller treats that as an upload
 * failure (FAILED status), not a silent pass-through of unprocessed bytes.
 */
export async function compressImage(data: Buffer, profileName: "standard" | "high-quality"): Promise<CompressedImage> {
  const profile = IMAGE_COMPRESSION_PROFILES[profileName];
  const pipeline = sharp(data).rotate() // apply EXIF orientation before stripping metadata
    .resize({ width: profile.maxDimensionPx, height: profile.maxDimensionPx, fit: "inside", withoutEnlargement: true })
    .webp({ quality: profile.quality });

  const { data: outData, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { data: outData, contentType: "image/webp", widthPx: info.width, heightPx: info.height, profile: profileName };
}

export const THUMBNAIL_MAX_DIMENSION_PX = 320;
export const THUMBNAIL_QUALITY = 70;

/** A small WebP thumbnail for list/gallery views — never the evidence of record, always derived from the already-compressed image. */
export async function generateThumbnail(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .resize({ width: THUMBNAIL_MAX_DIMENSION_PX, height: THUMBNAIL_MAX_DIMENSION_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}
