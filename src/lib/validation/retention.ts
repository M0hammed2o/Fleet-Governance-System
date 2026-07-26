import { z } from "zod";
import { mediaCategorySchema } from "@/lib/validation/media";

export const upsertRetentionPolicySchema = z.object({
  category: mediaCategorySchema,
  retentionDays: z.number().int().positive().optional(),
  includedStorageAllowanceBytes: z.number().nonnegative().nullable().optional(),
  archiveEligible: z.boolean().optional(),
});

export const setHoldSchema = z.object({
  hold: z.boolean(),
  reason: z.string().trim().min(1, "reason is required"),
});

export const extendRetentionSchema = z.object({
  newScheduledDeletionAt: z.coerce.date(),
  reason: z.string().trim().min(1, "reason is required"),
});

export const archiveAssetsSchema = z.object({
  mediaAssetIds: z.array(z.string().trim().min(1)).min(1, "at least one mediaAssetId is required"),
});

const deletionScopeSchema = z.object({
  categories: z.array(mediaCategorySchema).min(1, "at least one category is required"),
  dateRangeStart: z.coerce.date().optional(),
  dateRangeEnd: z.coerce.date().optional(),
});

export const createDeletionRequestSchema = z.object({
  scope: deletionScopeSchema,
  recoveryDays: z.number().int().positive().optional(),
});

export const rejectDeletionRequestSchema = z.object({
  reason: z.string().trim().min(1, "reason is required"),
});

export const createExportRequestSchema = z.object({
  scope: deletionScopeSchema,
});
