import { z } from "zod";

export const mediaAssetOwnerTypeSchema = z.enum([
  "GATE_EVENT",
  "GATE_EVENT_INSPECTION_ITEM",
  "MANUAL_FACIAL_VERIFICATION_FALLBACK",
  "DRIVER_PORTRAIT",
  "COMPLIANCE_DOCUMENT",
  "MOVEMENT_DOCUMENT",
]);

// Phase 8B storage/retention/billing categories — see lib/storage/media-categories.ts.
export const mediaCategorySchema = z.enum([
  "DRIVER_PORTRAIT",
  "FACIAL_AUDIT",
  "VEHICLE_INSPECTION_PHOTO",
  "VEHICLE_INSPECTION_VIDEO",
  "DAMAGE_EVIDENCE",
  "CARGO_EVIDENCE",
  "DELIVERY_DOCUMENT",
  "INVESTIGATION_EVIDENCE",
  "GENERATED_REPORT",
  "OTHER_DOCUMENT",
]);

// The `file` field itself isn't part of this schema — it's a File pulled
// directly off the multipart FormData in the route handler, not JSON. This
// schema validates the accompanying form fields only.
export const uploadMediaAssetFormSchema = z.object({
  ownerType: mediaAssetOwnerTypeSchema,
  ownerId: z.string().trim().min(1, "ownerId is required"),
  // Client-generated (e.g. crypto.randomUUID() at capture time) so retrying
  // the same upload over flaky gate connectivity is safe — see EVID-003.
  idempotencyKey: z.string().trim().min(1, "idempotencyKey is required").max(200),
  // Optional extra integrity cross-check — never trusted on its own, see
  // ChecksumMismatchError in media-asset-repository.ts.
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "checksumSha256 must be a 64-character hex SHA-256 digest")
    .optional(),
  category: mediaCategorySchema.optional(),
});

// Phase 8B — presigned direct-to-storage upload (JSON body, no file bytes).
export const initiatePresignedUploadSchema = z.object({
  ownerType: mediaAssetOwnerTypeSchema,
  ownerId: z.string().trim().min(1, "ownerId is required"),
  fileName: z.string().trim().min(1, "fileName is required").max(255),
  contentType: z.string().trim().min(1, "contentType is required"),
  idempotencyKey: z.string().trim().min(1, "idempotencyKey is required").max(200),
  category: mediaCategorySchema.optional(),
  captureMetadata: z.record(z.string(), z.unknown()).optional(),
});
