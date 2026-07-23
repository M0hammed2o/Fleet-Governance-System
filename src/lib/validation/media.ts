import { z } from "zod";

export const mediaAssetOwnerTypeSchema = z.enum([
  "GATE_EVENT",
  "GATE_EVENT_INSPECTION_ITEM",
  "MANUAL_FACIAL_VERIFICATION_FALLBACK",
  "DRIVER_PORTRAIT",
  "COMPLIANCE_DOCUMENT",
  "MOVEMENT_DOCUMENT",
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
});
