import { z } from "zod";

const isoDateToDate = z
  .string()
  .trim()
  .min(1)
  .transform((val) => new Date(val))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const createDriverSchema = z.object({
  employeeNumber: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  contactPhone: z.string().trim().max(50).optional(),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  department: z.string().trim().max(200).optional(),
  licenceNumber: z.string().trim().max(100).optional(),
  licenceClass: z.string().trim().max(50).optional(),
  licenceExpiry: isoDateToDate.optional(),
  pdpNumber: z.string().trim().max(100).optional(),
  pdpExpiry: isoDateToDate.optional(),
  authorisedVehicleClasses: z.array(z.string().trim().max(20)).optional(),
  restrictions: z.string().trim().max(1000).optional(),
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

// portraitMediaAssetId is update-only, not create-time: the referenced
// MediaAsset must already exist with ownerId=this driver's id, which is only
// possible once the driver itself exists (upload happens after creation) —
// see DECISIONS.md D-012.
export const updateDriverSchema = createDriverSchema.partial().extend({
  portraitMediaAssetId: z.string().trim().min(1).max(200).optional(),
});

export const driverStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BLACKLISTED"]),
});

export const requestManualFallbackSchema = z.object({
  reason: z.string().trim().min(10, "A reason of at least 10 characters is required").max(1000),
  relatedGateEventId: z.string().trim().min(1).max(200).optional(),
});

export const resolveManualFallbackSchema = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
});

// Evidence is attached in a separate step, after the fallback request (and
// therefore its id) already exists — see attachEvidenceToManualFallback() in
// facial-verification-repository.ts and DECISIONS.md D-012.
export const attachManualFallbackEvidenceSchema = z.object({
  evidenceMediaAssetId: z.string().trim().min(1, "evidenceMediaAssetId is required").max(200),
});
